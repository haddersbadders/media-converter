import subprocess
import threading
import time
import re
import queue
import json
import os
from concurrent.futures import ThreadPoolExecutor
from core.db import update_job_status, get_job, get_cached_video_info, cache_video_info

class JobManager:
    def __init__(self, max_workers=1):
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.active_jobs = {} # job_id -> process
        self.paused_jobs = set()
        self.queue_lock = threading.Lock()
        
        # Limit ffprobe concurrency to avoid CPU spikes
        try:
            cpu_count = os.cpu_count() or 4
            probe_workers = max(1, min(4, cpu_count))
        except Exception:
            probe_workers = 4
        self.ffprobe_semaphore = threading.Semaphore(probe_workers)
        
    def get_video_info(self, file_path):
        try:
            mtime = os.stat(file_path).st_mtime
        except Exception as e:
            print(f"Error stating file {file_path}: {e}")
            return {'frames': 0, 'codec_name': 'unknown'}

        cached_info = get_cached_video_info(file_path, mtime)
        if cached_info is not None:
            return cached_info

        cmd = [
            'ffprobe',
            '-v', 'error',
            '-select_streams', 'v:0',
            '-count_packets',
            '-show_entries', 'stream=nb_read_packets,duration,r_frame_rate,codec_name',
            '-of', 'json',
            file_path
        ]
        try:
            with self.ffprobe_semaphore:
                result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)
            stream = data.get('streams', [{}])[0]
            
            info = {}
            info['codec_name'] = stream.get('codec_name', 'unknown')
            
            # try to get frame count
            nb_frames = stream.get('nb_read_packets')
            if nb_frames:
                info['frames'] = int(nb_frames)
            else:
                # fallback to duration and framerate
                duration = float(stream.get('duration', 0))
                fps_str = stream.get('r_frame_rate', '0/1')
                if '/' in fps_str:
                    num, den = fps_str.split('/')
                    fps = float(num) / float(den) if float(den) != 0 else 0
                else:
                    fps = float(fps_str)
                    
                if duration and fps:
                    info['frames'] = int(duration * fps)
                else:
                    info['frames'] = 0
            
            # Cache the result
            cache_video_info(file_path, mtime, info)
            return info
            
        except Exception as e:
            print(f"Error getting video info for {file_path}: {e}")
            return {'frames': 0, 'codec_name': 'unknown'}

    def _run_ffmpeg(self, job_id, input_path, output_path, settings):
        job = get_job(job_id)
        if job and job.get('status') == 'CANCELLED':
            return
            
        update_job_status(job_id, 'PROCESSING', progress=0.0)
        
        info = self.get_video_info(input_path)
        total_frames = info.get('frames', 0)
        
        # Build ffmpeg command based on settings
        cmd = ['ffmpeg', '-y', '-i', input_path]
        
        vcodec = settings.get('vcodec', 'copy')
        hw_accel = settings.get('hw_accel', 'none')
        
        # Backward compatibility for old queue items
        if settings.get('use_qsv', False) and hw_accel == 'none':
            hw_accel = 'qsv'
            
        if vcodec != 'copy':
            if hw_accel == 'qsv':
                if vcodec == 'libx264':
                    vcodec = 'h264_qsv'
                elif vcodec == 'libx265':
                    vcodec = 'hevc_qsv'
            elif hw_accel == 'videotoolbox':
                if vcodec == 'libx264':
                    vcodec = 'h264_videotoolbox'
                elif vcodec == 'libx265':
                    vcodec = 'hevc_videotoolbox'
            elif hw_accel == 'nvenc':
                if vcodec == 'libx264':
                    vcodec = 'h264_nvenc'
                elif vcodec == 'libx265':
                    vcodec = 'hevc_nvenc'
            
            cmd.extend(['-c:v', vcodec])
            crf = settings.get('crf')
            if crf:
                if hw_accel == 'qsv':
                    cmd.extend(['-global_quality', str(crf)])
                elif hw_accel == 'nvenc':
                    cmd.extend(['-cq', str(crf)])
                elif hw_accel == 'videotoolbox':
                    cmd.extend(['-q:v', '50']) # Rough approximation for VTB
                else:
                    cmd.extend(['-crf', str(crf)])
            
            resolution = settings.get('resolution')
            if resolution and resolution != 'Keep Original':
                # Map resolution
                res_map = {
                    '1080p': 'scale=-2:1080',
                    '720p': 'scale=-2:720',
                    '480p': 'scale=-2:480'
                }
                if resolution in res_map:
                    cmd.extend(['-vf', res_map[resolution]])
        else:
            cmd.extend(['-c:v', 'copy'])
            
        acodec = settings.get('acodec', 'copy')
        cmd.extend(['-c:a', acodec])
        
        if settings.get('preset_type') == 'audio_only':
            cmd = ['ffmpeg', '-y', '-i', input_path, '-vn', '-c:a', acodec]
            if acodec == 'mp3':
                cmd.extend(['-q:a', '2'])
            
        cmd.append(output_path)
        
        print(f"[{job_id}] Running command: {' '.join(cmd)}")
        
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True
        )
        
        with self.queue_lock:
            self.active_jobs[job_id] = {'process': process, 'output_path': output_path}
            
        # Parse output
        frame_pattern = re.compile(r"frame=\s*(\d+)")
        speed_pattern = re.compile(r"speed=\s*([\d\.]+)x")
        time_pattern = re.compile(r"time=(\d+):(\d+):(\d+.\d+)")
        log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'logs')
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, f"{job_id}.log")
        
        try:
            log_f = open(log_path, 'w', encoding='utf-8')
            log_f.write(f"[{job_id}] Running command: {' '.join(cmd)}\n")
            
            for line in process.stdout:
                log_f.write(line)
                log_f.flush()
                
                if process.poll() is not None:
                    break
                    
                frame_match = frame_pattern.search(line)
                speed_match = speed_pattern.search(line)
                time_match = time_pattern.search(line)
                
                speed = ''
                if speed_match:
                    speed = speed_match.group(1) + 'x'
                    
                progress = 0.0
                eta_str = ''
                
                if frame_match and total_frames > 0:
                    current_frame = int(frame_match.group(1))
                    progress = min(100.0, (current_frame / total_frames) * 100)
                    
                    if speed_match and float(speed_match.group(1)) > 0:
                        fps = float(speed_match.group(1)) * 24 # rough estimate if we don't know fps
                        # Actually speed in ffmpeg means how many times real time
                        # let's calculate ETA based on remaining frames and current processing fps
                        pass # a bit complex, let's use time if available
                        
                if time_match and not (frame_match and total_frames > 0):
                    # Fallback to duration if we couldn't get frames
                    pass 
                    
                # Update DB every so often or let's just do it directly
                # To avoid hammering DB, could throttle
                if job_id not in self.paused_jobs:
                    update_job_status(job_id, 'PROCESSING', progress=round(progress, 2), speed=speed)
            
            log_f.close()
            process.wait()
            
            with self.queue_lock:
                if job_id in self.active_jobs:
                    del self.active_jobs[job_id]
            
            if process.returncode == 0:
                update_job_status(job_id, 'COMPLETED', progress=100.0)
            elif process.returncode == -9 or process.returncode == 9:
                update_job_status(job_id, 'CANCELLED')
            else:
                update_job_status(job_id, 'FAILED')
                
        except Exception as e:
            print(f"Job {job_id} failed with exception: {e}")
            update_job_status(job_id, 'FAILED')
            with self.queue_lock:
                if job_id in self.active_jobs:
                    del self.active_jobs[job_id]

    def submit_job(self, job_id, input_path, output_path, settings):
        self.executor.submit(self._run_ffmpeg, job_id, input_path, output_path, settings)

    def cancel_job(self, job_id):
        with self.queue_lock:
            job_info = self.active_jobs.get(job_id)
            if job_info:
                process = job_info['process']
                output_path = job_info['output_path']
                process.terminate() # SIGTERM
                time.sleep(0.5)
                if process.poll() is None:
                    process.kill() # SIGKILL
                del self.active_jobs[job_id]
                update_job_status(job_id, 'CANCELLED')
                
                if os.path.exists(output_path):
                    try:
                        os.remove(output_path)
                    except Exception as e:
                        print(f"Error removing cancelled output file: {e}")
                        
                return True
                
            # Check if it's a queued/paused job not in active_jobs (e.g. from app restart)
            job = get_job(job_id)
            if job and job.get('status') in ('QUEUED', 'PAUSED'):
                update_job_status(job_id, 'CANCELLED')
                return True
                
        return False

    def pause_job(self, job_id):
        with self.queue_lock:
            job_info = self.active_jobs.get(job_id)
            if job_info and job_id not in self.paused_jobs:
                process = job_info['process']
                import signal
                try:
                    process.send_signal(signal.SIGSTOP)
                    self.paused_jobs.add(job_id)
                    update_job_status(job_id, 'PAUSED')
                    return True
                except Exception as e:
                    print(f"Error pausing job: {e}")
        return False

    def resume_job(self, job_id):
        with self.queue_lock:
            job_info = self.active_jobs.get(job_id)
            if job_info and job_id in self.paused_jobs:
                process = job_info['process']
                import signal
                try:
                    process.send_signal(signal.SIGCONT)
                    self.paused_jobs.remove(job_id)
                    update_job_status(job_id, 'PROCESSING')
                    return True
                except Exception as e:
                    print(f"Error resuming job: {e}")
        return False

# Global instance
job_manager = JobManager(max_workers=1)

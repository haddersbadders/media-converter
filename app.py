from flask import Flask, request, jsonify, Response, render_template, send_from_directory
import os
import uuid
import time
import json
from core.db import init_db, add_job, get_all_jobs, delete_job, get_job
from core.job_manager import job_manager

app = Flask(__name__)

MEDIA_DIR = os.environ.get('MEDIA_DIR', os.path.expanduser('~/Movies/media'))

# Ensure media dir exists
os.makedirs(MEDIA_DIR, exist_ok=True)

@app.before_request
def initialize():
    if not hasattr(app, 'db_initialized'):
        init_db()
        app.db_initialized = True

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/files')
def list_files():
    path = request.args.get('path', '')
    flat = request.args.get('flat', 'false').lower() == 'true'
    target_dir = os.path.join(MEDIA_DIR, path)
    
    # Security check to prevent traversing outside MEDIA_DIR
    if not os.path.abspath(target_dir).startswith(os.path.abspath(MEDIA_DIR)):
        return jsonify({'error': 'Invalid path'}), 403
        
    if not os.path.exists(target_dir):
        return jsonify({'error': 'Directory not found'}), 404
        
    items = []
    
    VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'}
    
    if flat:
        for root, dirs, files in os.walk(target_dir):
            for file in files:
                if not any(file.lower().endswith(ext) for ext in VIDEO_EXTENSIONS):
                    continue
                file_path = os.path.join(root, file)
                try:
                    stat = os.stat(file_path)
                    items.append({
                        'name': os.path.relpath(file_path, target_dir) if root != target_dir else file,
                        'is_dir': False,
                        'path': os.path.relpath(file_path, MEDIA_DIR),
                        'size': stat.st_size,
                        'mtime': stat.st_mtime
                    })
                except Exception:
                    pass
    else:
        for entry in os.scandir(target_dir):
            if not entry.is_dir() and not any(entry.name.lower().endswith(ext) for ext in VIDEO_EXTENSIONS):
                continue
            stat = entry.stat()
            items.append({
                'name': entry.name,
                'is_dir': entry.is_dir(),
                'path': os.path.relpath(entry.path, MEDIA_DIR),
                'size': stat.st_size if not entry.is_dir() else 0,
                'mtime': stat.st_mtime
            })
        
    # Sort: folders first, then files alphabetically
    items.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    
    # Calculate breadcrumbs
    parts = path.strip('/').split('/')
    breadcrumbs = [{'name': 'Home', 'path': ''}]
    current = ''
    if path:
        for p in parts:
            if p:
                current += f"{p}/"
                breadcrumbs.append({'name': p, 'path': current.rstrip('/')})
                
    return jsonify({
        'current_path': path,
        'breadcrumbs': breadcrumbs,
        'items': items
    })

@app.route('/api/info')
def get_file_info():
    path = request.args.get('path', '')
    target_path = os.path.join(MEDIA_DIR, path)
    
    if not os.path.abspath(target_path).startswith(os.path.abspath(MEDIA_DIR)):
        return jsonify({'error': 'Invalid path'}), 403
        
    if not os.path.exists(target_path):
        return jsonify({'error': 'File not found'}), 404
        
    info = job_manager.get_video_info(target_path)
    return jsonify(info)

@app.route('/api/transcoded_files')
def get_transcoded_files():
    items = []
    for root, dirs, files in os.walk(MEDIA_DIR):
        for file in files:
            # Match files in a 'transcoded' directory or containing '_transcoded_'
            if os.path.basename(root) == 'transcoded' or '_transcoded_' in file:
                file_path = os.path.join(root, file)
                try:
                    stat = os.stat(file_path)
                    items.append({
                        'name': file,
                        'path': os.path.relpath(file_path, MEDIA_DIR),
                        'size': stat.st_size,
                        'mtime': stat.st_mtime
                    })
                except Exception:
                    pass
    
    # Sort newest first
    items.sort(key=lambda x: x['mtime'], reverse=True)
    return jsonify({'items': items})

@app.route('/api/files/<path:file_path>', methods=['DELETE'])
def delete_file(file_path):
    target_path = os.path.join(MEDIA_DIR, file_path)
    
    # Security check to prevent traversing outside MEDIA_DIR
    if not os.path.abspath(target_path).startswith(os.path.abspath(MEDIA_DIR)):
        return jsonify({'error': 'Invalid path'}), 403
        
    if os.path.exists(target_path) and os.path.isfile(target_path):
        try:
            os.remove(target_path)
            return jsonify({'status': 'DELETED'})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    return jsonify({'error': 'File not found'}), 404

@app.route('/api/jobs', methods=['GET'])
def get_jobs():
    jobs = get_all_jobs()
    return jsonify(jobs)

@app.route('/api/jobs', methods=['POST'])
def create_job():
    data = request.json
    input_rel_path = data.get('input_path')
    settings = data.get('settings', {})
    
    if not input_rel_path:
        return jsonify({'error': 'Input path required'}), 400
        
    input_path = os.path.join(MEDIA_DIR, input_rel_path)
    if not os.path.exists(input_path):
        return jsonify({'error': 'Input file not found'}), 404
        
    job_id = str(uuid.uuid4())
    
    # Determine output path
    dir_name = os.path.dirname(input_rel_path)
    base_name = os.path.splitext(os.path.basename(input_rel_path))[0]
    
    ext = '.mp4'
    if settings.get('preset_type') == 'audio_only':
        ext = '.mp3' if settings.get('acodec', 'mp3') == 'mp3' else '.m4a'
        
    output_rel_path = os.path.join("transcoded", f"{base_name}_transcoded_{int(time.time())}{ext}")
    output_path = os.path.join(MEDIA_DIR, output_rel_path)
    
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    add_job(job_id, input_rel_path, output_rel_path, settings)
    job_manager.submit_job(job_id, input_path, output_path, settings)
    
    return jsonify({'job_id': job_id, 'status': 'QUEUED'})

@app.route('/api/jobs/<job_id>/cancel', methods=['POST'])
def cancel_job_route(job_id):
    if job_manager.cancel_job(job_id):
        return jsonify({'status': 'CANCELLED'})
    return jsonify({'error': 'Job not active or not found'}), 404

@app.route('/api/jobs/<job_id>/pause', methods=['POST'])
def pause_job_route(job_id):
    if job_manager.pause_job(job_id):
        return jsonify({'status': 'PAUSED'})
    return jsonify({'error': 'Job not active or not found'}), 404

@app.route('/api/jobs/<job_id>/resume', methods=['POST'])
def resume_job_route(job_id):
    if job_manager.resume_job(job_id):
        return jsonify({'status': 'PROCESSING'})
    return jsonify({'error': 'Job not active or not found'}), 404

@app.route('/api/jobs/<job_id>', methods=['DELETE'])
def remove_job(job_id):
    delete_file = request.args.get('delete_file', 'false').lower() == 'true'
    if delete_file:
        job = get_job(job_id)
        if job and job.get('output_path'):
            full_path = os.path.join(MEDIA_DIR, job['output_path'])
            if os.path.exists(full_path):
                try:
                    os.remove(full_path)
                except Exception as e:
                    print(f"Error deleting file {full_path}: {e}")
                    
    delete_job(job_id)
    return jsonify({'status': 'REMOVED'})

@app.route('/api/jobs/<job_id>/logs', methods=['GET'])
def get_job_logs(job_id):
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'logs', f"{job_id}.log")
    if not os.path.exists(log_path):
        return jsonify({'error': 'Log not found'}), 404
        
    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return jsonify({'logs': content})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/queue/stream')
def stream_queue():
    def event_stream():
        from core.db import job_update_cond
        last_jobs_json = ""
        while True:
            jobs = get_all_jobs()
            jobs_json = json.dumps(jobs)
            if jobs_json != last_jobs_json:
                yield f"data: {jobs_json}\n\n"
                last_jobs_json = jobs_json
            
            with job_update_cond:
                job_update_cond.wait(timeout=15.0)
            
    return Response(event_stream(), mimetype="text/event-stream")

if __name__ == '__main__':
    from waitress import serve
    print("Starting production server with waitress on port 5000...")
    serve(app, host='0.0.0.0', port=5000, threads=8)

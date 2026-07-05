import os
import time
from core.db import init_db
from core.job_manager import job_manager

def test():
    init_db()
    
    # Create a dummy video file
    dummy_file = "dummy.mp4"
    os.system(f"ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=30 -c:v libx264 -y {dummy_file} 2>/dev/null")
    
    print("Testing first call (cold cache)...")
    start = time.time()
    info1 = job_manager.get_video_info(dummy_file)
    time1 = time.time() - start
    print(f"Info: {info1}, Time: {time1:.4f}s")
    
    print("Testing second call (warm cache)...")
    start = time.time()
    info2 = job_manager.get_video_info(dummy_file)
    time2 = time.time() - start
    print(f"Info: {info2}, Time: {time2:.4f}s")
    
    if time2 < time1 * 0.5: # Should be much faster
        print("SUCCESS: Cache is working and much faster.")
    else:
        print("WARNING: Cache might not be working as expected.")
        
    os.remove(dummy_file)

if __name__ == "__main__":
    test()

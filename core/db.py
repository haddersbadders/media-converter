import sqlite3
import os
import json
import threading
from datetime import datetime

job_update_cond = threading.Condition()

def notify_update():
    with job_update_cond:
        job_update_cond.notify_all()

# Default DB path, can be overridden by environment variable
DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'db.sqlite'))

def get_db_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            filename TEXT,
            output_path TEXT,
            status TEXT,
            progress REAL,
            speed TEXT,
            eta TEXT,
            settings TEXT,
            created_at DATETIME
        )
    ''')
    
    # On startup, mark any 'PROCESSING' jobs as 'FAILED' or 'QUEUED' 
    # since they were interrupted by server restart. 
    # For now, let's just mark them as FAILED.
    c.execute('''
        UPDATE jobs 
        SET status = 'FAILED' 
        WHERE status = 'PROCESSING'
    ''')
    
    c.execute('''
        CREATE TABLE IF NOT EXISTS video_metadata (
            file_path TEXT PRIMARY KEY,
            mtime REAL,
            metadata TEXT
        )
    ''')

    conn.commit()
    conn.close()

def add_job(job_id, filename, output_path, settings):
    conn = get_db_connection()
    c = conn.cursor()
    created_at = datetime.now().isoformat()
    c.execute('''
        INSERT INTO jobs (id, filename, output_path, status, progress, speed, eta, settings, created_at)
        VALUES (?, ?, ?, 'QUEUED', 0.0, '', '', ?, ?)
    ''', (job_id, filename, output_path, json.dumps(settings), created_at))
    conn.commit()
    conn.close()
    notify_update()

def update_job_status(job_id, status, progress=None, speed=None, eta=None):
    conn = get_db_connection()
    c = conn.cursor()
    updates = ["status = ?"]
    params = [status]
    
    if progress is not None:
        updates.append("progress = ?")
        params.append(progress)
    if speed is not None:
        updates.append("speed = ?")
        params.append(speed)
    if eta is not None:
        updates.append("eta = ?")
        params.append(eta)
        
    params.append(job_id)
    
    query = f"UPDATE jobs SET {', '.join(updates)} WHERE id = ?"
    c.execute(query, tuple(params))
    conn.commit()
    conn.close()
    notify_update()

def get_all_jobs():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('SELECT * FROM jobs ORDER BY created_at DESC')
    jobs = [dict(row) for row in c.fetchall()]
    conn.close()
    return jobs

def get_job(job_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('SELECT * FROM jobs WHERE id = ?', (job_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def delete_job(job_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('DELETE FROM jobs WHERE id = ?', (job_id,))
    conn.commit()
    conn.close()
    notify_update()

def get_cached_video_info(file_path, current_mtime):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('SELECT mtime, metadata FROM video_metadata WHERE file_path = ?', (file_path,))
    row = c.fetchone()
    conn.close()
    
    if row and row['mtime'] == current_mtime:
        try:
            return json.loads(row['metadata'])
        except Exception:
            pass
    return None

def cache_video_info(file_path, current_mtime, metadata):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        INSERT INTO video_metadata (file_path, mtime, metadata)
        VALUES (?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
            mtime=excluded.mtime,
            metadata=excluded.metadata
    ''', (file_path, current_mtime, json.dumps(metadata)))
    conn.commit()
    conn.close()


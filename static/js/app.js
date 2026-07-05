document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentPath = '';
    let selectedFile = null;
    let fileItems = [];

    // DOM Elements
    const fileListEl = document.getElementById('fileList');
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    const btnUpLevel = document.getElementById('btnUpLevel');
    const searchInput = document.getElementById('searchInput');
    const detailsCard = document.getElementById('detailsCard');
    const selectedFilenameEl = document.getElementById('selectedFilename');
    const selectedFileStatsEl = document.getElementById('selectedFileStats');
    const btnTranscode = document.getElementById('btnTranscode');
    const queueListEl = document.getElementById('queueList');

    // Init
    loadFiles('');
    setupSSE();

    // Event Listeners
    btnUpLevel.addEventListener('click', () => {
        if (currentPath) {
            const parts = currentPath.split('/').filter(Boolean);
            parts.pop();
            loadFiles(parts.join('/'));
        }
    });

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        renderFileList(fileItems.filter(item => 
            item.name.toLowerCase().includes(query)
        ));
    });

    btnTranscode.addEventListener('click', () => {
        if (!selectedFile) return;

        const presetEl = document.querySelector('input[name="preset"]:checked');
        const preset = presetEl ? presetEl.value : 'universal';
        
        let settings = { preset_type: preset };
        
        if (preset === 'universal') {
            settings.vcodec = 'libx264';
            settings.acodec = 'aac';
        } else if (preset === 'spacesaver') {
            settings.vcodec = 'libx265';
            settings.acodec = 'aac';
        } else if (preset === 'hq') {
            settings.vcodec = 'libx264';
            settings.crf = 18;
            settings.acodec = 'copy';
        } else if (preset === 'audio_only') {
            settings.preset_type = 'audio_only';
            settings.vcodec = 'copy';
            settings.acodec = 'mp3';
        }

        fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input_path: selectedFile.path,
                settings: settings
            })
        }).then(res => res.json()).then(data => {
            console.log('Job submitted', data);
        }).catch(err => {
            console.error('Error submitting job', err);
        });
    });

    // Functions
    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    function loadFiles(path) {
        fetch(`/api/files?path=${encodeURIComponent(path)}`)
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    console.error(data.error);
                    return;
                }
                currentPath = data.current_path;
                fileItems = data.items;
                renderBreadcrumbs(data.breadcrumbs);
                renderFileList(fileItems);
            })
            .catch(err => console.error(err));
    }

    function renderBreadcrumbs(crumbs) {
        breadcrumbsEl.innerHTML = '';
        crumbs.forEach((crumb, index) => {
            const a = document.createElement('a');
            a.className = 'breadcrumb-link';
            a.textContent = crumb.name;
            a.href = '#';
            a.onclick = (e) => {
                e.preventDefault();
                loadFiles(crumb.path);
            };
            breadcrumbsEl.appendChild(a);
            
            if (index < crumbs.length - 1) {
                const sep = document.createElement('span');
                sep.textContent = ' / ';
                sep.style.color = 'var(--text-secondary)';
                breadcrumbsEl.appendChild(sep);
            }
        });
    }

    function renderFileList(items) {
        fileListEl.innerHTML = '';
        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'file-item';
            if (selectedFile && selectedFile.path === item.path) {
                li.classList.add('selected');
            }

            const icon = document.createElement('span');
            icon.className = 'file-icon';
            icon.textContent = item.is_dir ? '📁' : '🎬';
            
            const name = document.createElement('span');
            name.className = 'file-name';
            name.textContent = item.name;
            
            const size = document.createElement('span');
            size.className = 'file-size';
            size.textContent = item.is_dir ? '' : formatBytes(item.size);

            li.appendChild(icon);
            li.appendChild(name);
            li.appendChild(size);

            li.addEventListener('click', () => {
                if (item.is_dir) {
                    loadFiles(item.path);
                } else {
                    selectFile(item, li);
                }
            });

            fileListEl.appendChild(li);
        });
    }

    function selectFile(item, liElement) {
        selectedFile = item;
        // Update UI selection
        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
        if (liElement) liElement.classList.add('selected');

        detailsCard.style.display = 'flex';
        selectedFilenameEl.textContent = item.name;
        selectedFileStatsEl.textContent = `Path: ${item.path} | Size: ${formatBytes(item.size)}`;
    }

    function setupSSE() {
        const evtSource = new EventSource('/queue/stream');
        evtSource.onmessage = function(event) {
            const jobs = JSON.parse(event.data);
            renderQueue(jobs);
        };
        evtSource.onerror = function(err) {
            console.error("SSE Error:", err);
        };
    }

    function renderQueue(jobs) {
        queueListEl.innerHTML = '';
        if (jobs.length === 0) {
            queueListEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:2rem;">No active jobs</div>';
            return;
        }

        jobs.forEach(job => {
            const item = document.createElement('div');
            item.className = 'queue-item';

            let statusColorClass = '';
            if (job.status === 'QUEUED') statusColorClass = 'status-queued';
            if (job.status === 'PROCESSING') statusColorClass = 'status-processing';
            if (job.status === 'COMPLETED') statusColorClass = 'status-completed';
            if (job.status === 'FAILED') statusColorClass = 'status-failed';
            if (job.status === 'CANCELLED') statusColorClass = 'status-cancelled';

            const progress = job.progress || 0;

            item.innerHTML = `
                <div class="queue-header">
                    <span class="queue-status ${statusColorClass}">[${job.status}]</span>
                    <span class="queue-stats">${progress.toFixed(1)}%</span>
                </div>
                <div class="queue-filename">${job.filename}</div>
                <div class="progress-track">
                    <div class="progress-bar" style="width: ${progress}%"></div>
                </div>
                <div class="queue-stats">
                    <span>Speed: ${job.speed || '-'}</span>
                    <span>ETA: ${job.eta || '-'}</span>
                </div>
                <div class="queue-actions">
                    ${job.status === 'PROCESSING' || job.status === 'QUEUED' ? 
                        `<button class="btn-small" onclick="cancelJob('${job.id}')">Cancel</button>` : 
                        `<button class="btn-small" onclick="removeJob('${job.id}')">Remove</button>`
                    }
                </div>
            `;
            queueListEl.appendChild(item);
        });
    }

    window.cancelJob = function(jobId) {
        fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
    };

    window.removeJob = function(jobId) {
        fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    };
});

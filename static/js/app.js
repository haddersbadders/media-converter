document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentPath = '';
    let selectedItems = new Map(); // path -> item
    let fileItems = [];
    let isFlatView = false;
    let currentSort = 'name';
    let sortDesc = false;

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
    const toggleFlatView = document.getElementById('toggleFlatView');
    const sortName = document.getElementById('sortName');
    const sortCodec = document.getElementById('sortCodec');
    const sortDate = document.getElementById('sortDate');
    const sortSize = document.getElementById('sortSize');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');

    // Init
    loadFiles('', isFlatView);
    setupSSE();

    // Tab Switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Event Listeners
    btnUpLevel.addEventListener('click', () => {
        if (currentPath) {
            const parts = currentPath.split('/').filter(Boolean);
            parts.pop();
            loadFiles(parts.join('/'), isFlatView);
        }
    });

    toggleFlatView.addEventListener('change', (e) => {
        isFlatView = e.target.checked;
        loadFiles(currentPath, isFlatView);
    });

    selectAllCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            fileItems.forEach(item => {
                if (!item.is_dir) selectedItems.set(item.path, item);
            });
        } else {
            selectedItems.clear();
        }
        updateSelectionUI();
    });

    function handleSort(column) {
        if (currentSort === column) {
            sortDesc = !sortDesc;
        } else {
            currentSort = column;
            sortDesc = false;
        }
        updateSortHeaders();
        sortAndRenderFiles();
    }

    sortName.addEventListener('click', () => handleSort('name'));
    sortCodec.addEventListener('click', () => handleSort('codec'));
    sortDate.addEventListener('click', () => handleSort('date'));
    sortSize.addEventListener('click', () => handleSort('size'));

    function updateSortHeaders() {
        sortName.textContent = `Name ${currentSort === 'name' ? (sortDesc ? '↓' : '↑') : '↕'}`;
        sortCodec.textContent = `Codec ${currentSort === 'codec' ? (sortDesc ? '↓' : '↑') : '↕'}`;
        sortDate.textContent = `Date ${currentSort === 'date' ? (sortDesc ? '↓' : '↑') : '↕'}`;
        sortSize.textContent = `Size ${currentSort === 'size' ? (sortDesc ? '↓' : '↑') : '↕'}`;
    }

    searchInput.addEventListener('input', (e) => {
        sortAndRenderFiles();
    });

    btnTranscode.addEventListener('click', () => {
        if (selectedItems.size === 0) return;

        const originalText = btnTranscode.textContent;
        btnTranscode.textContent = 'Starting...';
        btnTranscode.disabled = true;

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

        const promises = [];
        for (const item of selectedItems.values()) {
            promises.push(
                fetch('/api/jobs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        input_path: item.path,
                        settings: settings
                    })
                }).then(res => res.json())
            );
        }

        Promise.all(promises).then(results => {
            console.log('Jobs submitted', results);
            btnTranscode.textContent = 'Started! Check Queue...';
            btnTranscode.style.backgroundColor = 'var(--accent-green)';
            btnTranscode.style.color = '#000';
            selectedItems.clear();
            updateSelectionUI();
            
            setTimeout(() => {
                btnTranscode.textContent = originalText;
                btnTranscode.disabled = false;
                btnTranscode.style.backgroundColor = '';
                btnTranscode.style.color = '';
            }, 3000);
        }).catch(err => {
            console.error('Error submitting jobs', err);
            btnTranscode.textContent = 'Error starting jobs';
            btnTranscode.style.backgroundColor = 'var(--accent-red)';
            setTimeout(() => {
                btnTranscode.textContent = originalText;
                btnTranscode.disabled = false;
                btnTranscode.style.backgroundColor = '';
            }, 3000);
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

    function formatDate(timestamp) {
        if (!timestamp) return '';
        const d = new Date(timestamp * 1000);
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + 
               d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function truncateMiddle(str, maxLength = 55) {
        if (!str || str.length <= maxLength) return str;
        
        const lastDot = str.lastIndexOf('.');
        if (lastDot !== -1 && str.length - lastDot <= 10) {
            const ext = str.substring(lastDot);
            const name = str.substring(0, lastDot);
            const keepLength = maxLength - ext.length - 3;
            const startKeep = Math.ceil(keepLength / 2);
            const endKeep = Math.floor(keepLength / 2);
            return name.substring(0, startKeep) + '...' + name.substring(name.length - endKeep) + ext;
        } else {
            const keepLength = maxLength - 3;
            const startKeep = Math.ceil(keepLength / 2);
            const endKeep = Math.floor(keepLength / 2);
            return str.substring(0, startKeep) + '...' + str.substring(str.length - endKeep);
        }
    }

    function loadFiles(path, flat = false) {
        fetch(`/api/files?path=${encodeURIComponent(path)}&flat=${flat}`)
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    console.error(data.error);
                    return;
                }
                currentPath = data.current_path;
                fileItems = data.items;
                renderBreadcrumbs(data.breadcrumbs);
                
                // Fetch codecs asynchronously
                fileItems.forEach(item => {
                    if (!item.is_dir) {
                        item.codec = '...';
                        fetch(`/api/info?path=${encodeURIComponent(item.path)}`)
                            .then(res => res.json())
                            .then(info => {
                                item.codec = info.codec_name && info.codec_name !== 'unknown' ? info.codec_name.toUpperCase() : 'Unknown';
                                if (item.codecEl) item.codecEl.textContent = item.codec;
                            })
                            .catch(err => {
                                item.codec = 'Error';
                                if (item.codecEl) item.codecEl.textContent = item.codec;
                            });
                    }
                });
                
                sortAndRenderFiles();
            })
            .catch(err => console.error(err));
    }

    function sortAndRenderFiles() {
        const query = searchInput.value.toLowerCase();
        let filtered = fileItems.filter(item => item.name.toLowerCase().includes(query));
        
        let sorted = [...filtered];
        sorted.sort((a, b) => {
            if (a.is_dir && !b.is_dir) return -1;
            if (!a.is_dir && b.is_dir) return 1;
            
            let cmp = 0;
            if (currentSort === 'name') {
                cmp = a.name.localeCompare(b.name);
            } else if (currentSort === 'size') {
                cmp = a.size - b.size;
            } else if (currentSort === 'codec') {
                const codecA = a.codec || '';
                const codecB = b.codec || '';
                cmp = codecA.localeCompare(codecB);
            } else if (currentSort === 'date') {
                cmp = (a.mtime || 0) - (b.mtime || 0);
            }
            return sortDesc ? -cmp : cmp;
        });
        renderFileList(sorted);
        updateSelectionUI();
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
                loadFiles(crumb.path, isFlatView);
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
            li.setAttribute('data-path', item.path);

            const checkboxContainer = document.createElement('div');
            checkboxContainer.style.width = '2rem';
            checkboxContainer.style.display = 'flex';
            checkboxContainer.style.justifyContent = 'center';
            checkboxContainer.style.alignItems = 'center';
            checkboxContainer.style.marginRight = '0.5rem';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            
            if (item.is_dir) {
                checkbox.style.visibility = 'hidden';
            } else {
                checkbox.checked = selectedItems.has(item.path);
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        selectedItems.set(item.path, item);
                    } else {
                        selectedItems.delete(item.path);
                    }
                    updateSelectionUI();
                });
                checkbox.addEventListener('click', (e) => e.stopPropagation());
            }
            checkboxContainer.appendChild(checkbox);

            const icon = document.createElement('span');
            icon.className = 'file-icon';
            icon.textContent = item.is_dir ? '📁' : '🎬';
            
            const nameContainer = document.createElement('span');
            nameContainer.className = 'file-name';
            nameContainer.style.display = 'flex';
            nameContainer.style.alignItems = 'center';
            nameContainer.style.gap = '8px';
            nameContainer.style.flex = '1';
            nameContainer.style.minWidth = '0';
            
            const nameText = document.createElement('span');
            nameText.className = 'file-name-text';
            nameText.textContent = truncateMiddle(item.name, 55);
            nameText.title = item.name;
            nameText.style.whiteSpace = 'nowrap';
            nameText.style.overflow = 'hidden';
            nameText.style.textOverflow = 'ellipsis';
            nameContainer.appendChild(nameText);
            
            const badgesContainer = document.createElement('span');
            badgesContainer.style.display = 'flex';
            badgesContainer.style.gap = '4px';
            badgesContainer.style.flexShrink = '0';
            nameContainer.appendChild(badgesContainer);
            
            if (!item.is_dir && item.name.includes('_transcoded_')) {
                const badge = document.createElement('span');
                badge.textContent = 'Transcoded';
                badge.style.fontSize = '0.7em';
                badge.style.padding = '2px 6px';
                badge.style.borderRadius = '12px';
                badge.style.backgroundColor = 'var(--accent-color, #4CAF50)';
                badge.style.color = '#fff';
                badge.style.fontWeight = 'bold';
                badgesContainer.appendChild(badge);
            } else if (!item.is_dir) {
                const dirPath = item.path.lastIndexOf('/') !== -1 ? item.path.substring(0, item.path.lastIndexOf('/')) : '';
                const baseFileName = item.name.lastIndexOf('.') !== -1 ? item.name.substring(0, item.name.lastIndexOf('.')) : item.name;
                const expectedTranscodedDir = dirPath ? `${dirPath}/transcoded/` : 'transcoded/';
                
                const hasTranscodedSibling = fileItems.some(other => 
                    other !== item && !other.is_dir && 
                    other.path.startsWith(expectedTranscodedDir) &&
                    other.name.startsWith(baseFileName + '_transcoded_')
                );
                
                if (hasTranscodedSibling) {
                    const badge = document.createElement('span');
                    badge.textContent = 'Original';
                    badge.style.fontSize = '0.7em';
                    badge.style.padding = '2px 6px';
                    badge.style.borderRadius = '12px';
                    badge.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    badge.style.border = '1px solid var(--text-secondary)';
                    badge.style.color = 'var(--text-secondary)';
                    badge.style.fontWeight = 'bold';
                    badgesContainer.appendChild(badge);
                }
            }
            
            const codecSpan = document.createElement('span');
            codecSpan.className = 'file-codec';
            codecSpan.style.width = '100px';
            codecSpan.style.color = 'var(--text-secondary)';
            codecSpan.style.fontSize = '0.85rem';
            codecSpan.style.textAlign = 'left';
            codecSpan.textContent = item.is_dir ? '' : (item.codec || '...');
            item.codecEl = codecSpan;
            
            const dateSpan = document.createElement('span');
            dateSpan.className = 'file-date';
            dateSpan.style.width = '140px';
            dateSpan.style.textAlign = 'right';
            dateSpan.style.color = 'var(--text-secondary)';
            dateSpan.style.fontSize = '0.85rem';
            dateSpan.style.fontFamily = 'var(--font-mono)';
            dateSpan.textContent = formatDate(item.mtime);
            
            const size = document.createElement('span');
            size.className = 'file-size';
            size.style.width = '100px';
            size.style.textAlign = 'right';
            size.textContent = item.is_dir ? '' : formatBytes(item.size);

            li.appendChild(checkboxContainer);
            li.appendChild(icon);
            li.appendChild(nameContainer);
            li.appendChild(codecSpan);
            li.appendChild(dateSpan);
            li.appendChild(size);

            li.addEventListener('click', () => {
                if (item.is_dir) {
                    loadFiles(item.path, isFlatView);
                } else {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });

            fileListEl.appendChild(li);
        });
    }

    function updateSelectionUI() {
        const allFiles = fileItems.filter(i => !i.is_dir);
        if (allFiles.length > 0 && allFiles.every(i => selectedItems.has(i.path))) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else if (allFiles.some(i => selectedItems.has(i.path))) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }

        if (selectedItems.size === 0) {
            detailsCard.style.display = 'none';
        } else {
            detailsCard.style.display = 'flex';
            if (selectedItems.size === 1) {
                const item = Array.from(selectedItems.values())[0];
                selectedFilenameEl.textContent = truncateMiddle(item.name, 40);
                selectedFileStatsEl.textContent = `Path: ${item.path} | Size: ${formatBytes(item.size)} | Codec: ${item.codec || 'Unknown'}`;
            } else {
                selectedFilenameEl.textContent = `${selectedItems.size} Files Selected`;
                let totalSize = 0;
                selectedItems.forEach(item => totalSize += item.size);
                selectedFileStatsEl.textContent = `Total Size: ${formatBytes(totalSize)}`;
            }
        }
        
        document.querySelectorAll('.file-item').forEach(li => {
            const path = li.getAttribute('data-path');
            if (selectedItems.has(path)) {
                li.classList.add('selected');
            } else {
                li.classList.remove('selected');
            }
        });
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
            if (job.status === 'PAUSED') statusColorClass = 'status-paused';
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
                    ${(job.status === 'PROCESSING' || job.status === 'QUEUED') ? 
                        `<button class="btn-small" onclick="pauseJob('${job.id}')">Pause</button>
                         <button class="btn-small" onclick="cancelJob('${job.id}')">Cancel</button>` : 
                      job.status === 'PAUSED' ? 
                        `<button class="btn-small" onclick="resumeJob('${job.id}')">Resume</button>
                         <button class="btn-small" onclick="cancelJob('${job.id}')">Cancel</button>` :
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

    window.pauseJob = function(jobId) {
        fetch(`/api/jobs/${jobId}/pause`, { method: 'POST' });
    };

    window.resumeJob = function(jobId) {
        fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
    };

    window.removeJob = function(jobId) {
        fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    };
});

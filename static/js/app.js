document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentPath = '';
    let selectedItems = new Map(); // path -> item
    let fileItems = [];
    let isFlatView = false;
    let currentSort = 'name';
    let sortDesc = false;
    let globalTranscodedFiles = [];
    let currentVisibleItems = [];

    // DOM Elements
    const fileListEl = document.getElementById('fileList');
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    const btnUpLevel = document.getElementById('btnUpLevel');
    const searchInput = document.getElementById('searchInput');
    const detailsCard = document.getElementById('detailsCard');
    const selectedFilenameEl = document.getElementById('selectedFilename');
    const selectedFileStatsEl = document.getElementById('selectedFileStats');
    const btnTranscode = document.getElementById('btnTranscode');
    const btnDeleteSelected = document.getElementById('btnDeleteSelected');
    const queueListEl = document.getElementById('queueList');
    const toggleFlatView = document.getElementById('toggleFlatView');
    const sortName = document.getElementById('sortName');
    const sortCodec = document.getElementById('sortCodec');
    const sortDate = document.getElementById('sortDate');
    const sortSize = document.getElementById('sortSize');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const mediaFilter = document.getElementById('mediaFilter');

    // Init
    loadFiles('', isFlatView);
    setupSSE();
    loadGlobalTranscodedFiles();

    function loadGlobalTranscodedFiles() {
        fetch('/api/transcoded_files')
            .then(res => res.json())
            .then(data => {
                if (data.items) {
                    globalTranscodedFiles = data.items;
                    sortAndRenderFiles();
                }
            })
            .catch(err => console.error("Error loading transcoded files globally:", err));
    }

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

    if (mediaFilter) {
        mediaFilter.addEventListener('change', () => {
            sortAndRenderFiles();
        });
    }

    selectAllCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            currentVisibleItems.forEach(item => {
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
        const hwAccelEl = document.getElementById('hwAccel');
        const hwAccel = hwAccelEl ? hwAccelEl.value : 'none';
        
        let settings = { preset_type: preset, hw_accel: hwAccel };
        
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

    if (btnDeleteSelected) {
        btnDeleteSelected.addEventListener('click', () => {
            if (selectedItems.size === 0) return;

            if (!confirm(`Are you sure you want to permanently delete ${selectedItems.size} selected file(s)?`)) {
                return;
            }

            const originalText = btnDeleteSelected.textContent;
            btnDeleteSelected.textContent = 'Deleting...';
            btnDeleteSelected.disabled = true;

            const promises = [];
            for (const item of selectedItems.values()) {
                if (!item.is_dir) {
                    promises.push(
                        fetch(`/api/files/${encodeURIComponent(item.path)}`, { method: 'DELETE' })
                            .then(res => res.json())
                    );
                }
            }

            Promise.all(promises).then(results => {
                let hasError = false;
                results.forEach(res => {
                    if (res.error) {
                        console.error('Error deleting file:', res.error);
                        hasError = true;
                    }
                });

                if (hasError) {
                    alert('Some files could not be deleted. Check console for details.');
                }
                
                selectedItems.clear();
                updateSelectionUI();
                loadFiles(currentPath, isFlatView); // Refresh the current view
                
                btnDeleteSelected.textContent = originalText;
                btnDeleteSelected.disabled = false;
            }).catch(err => {
                console.error('Error deleting files', err);
                alert('An error occurred while deleting files.');
                btnDeleteSelected.textContent = originalText;
                btnDeleteSelected.disabled = false;
            });
        });
    }

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
                let filesToScan = 0;
                let filesScanned = 0;
                const scanProgressEl = document.getElementById('scanProgress');
                
                fileItems.forEach(item => {
                    if (!item.is_dir) filesToScan++;
                });

                if (filesToScan > 0 && scanProgressEl) {
                    scanProgressEl.style.display = 'inline-block';
                    scanProgressEl.textContent = `Scanning metadata: 0/${filesToScan}`;
                } else if (scanProgressEl) {
                    scanProgressEl.style.display = 'none';
                }

                const scanQueue = fileItems.filter(i => !i.is_dir);
                let activeScans = 0;
                const MAX_CONCURRENT = 5;

                function processNextScan() {
                    if (scanQueue.length === 0 || activeScans >= MAX_CONCURRENT) {
                        return;
                    }

                    const item = scanQueue.shift();
                    activeScans++;
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
                        })
                        .finally(() => {
                            filesScanned++;
                            activeScans--;
                            if (scanProgressEl) {
                                scanProgressEl.textContent = `Scanning metadata: ${filesScanned}/${filesToScan}`;
                                if (filesScanned >= filesToScan) {
                                    setTimeout(() => {
                                        scanProgressEl.style.display = 'none';
                                    }, 1000);
                                }
                            }
                            processNextScan();
                        });
                        
                    // Try to start more if we have capacity
                    processNextScan();
                }

                // Kick off initial workers
                for (let i = 0; i < MAX_CONCURRENT; i++) {
                    processNextScan();
                }
                
                sortAndRenderFiles();
            })
            .catch(err => console.error(err));
    }

    function checkHasTranscodedSibling(item) {
        const nameWithoutPath = item.name.includes('/') ? item.name.substring(item.name.lastIndexOf('/') + 1) : item.name;
        const baseFileName = nameWithoutPath.lastIndexOf('.') !== -1 ? nameWithoutPath.substring(0, nameWithoutPath.lastIndexOf('.')) : nameWithoutPath;
        
        const isTranscodedVersion = (otherName) => {
            const otherNameWithoutPath = otherName.includes('/') ? otherName.substring(otherName.lastIndexOf('/') + 1) : otherName;
            return otherNameWithoutPath.startsWith(baseFileName + '_transcoded_');
        };

        return fileItems.some(other => 
            other !== item && !other.is_dir && isTranscodedVersion(other.name)
        ) || globalTranscodedFiles.some(other => 
            isTranscodedVersion(other.name)
        );
    }

    function sortAndRenderFiles() {
        const query = searchInput.value.toLowerCase();
        const filterVal = mediaFilter ? mediaFilter.value : 'all';
        
        let filtered = fileItems.filter(item => {
            if (!item.name.toLowerCase().includes(query)) return false;
            if (item.is_dir) return true; // Always show directories (can be improved to hide empty ones, but keeping it simple)
            
            const isTranscoded = item.name.includes('_transcoded_') || item.path.split('/').includes('transcoded');
            
            if (filterVal === 'transcoded') return isTranscoded;
            if (filterVal === 'except_transcoded') return !isTranscoded;
            
            if (filterVal === 'original' || filterVal === 'not_transcoded') {
                if (isTranscoded) return false;
                const hasSibling = checkHasTranscodedSibling(item);
                if (filterVal === 'original') return hasSibling;
                if (filterVal === 'not_transcoded') return !hasSibling;
            }
            
            return true; // 'all'
        });
        
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
        currentVisibleItems = sorted;
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
            
            if (!item.is_dir && (item.name.includes('_transcoded_') || item.path.split('/').includes('transcoded'))) {
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
                const hasTranscodedSibling = checkHasTranscodedSibling(item);
                
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
        const allFiles = currentVisibleItems.filter(i => !i.is_dir);
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
                    <button class="btn-small" onclick="viewLogs('${job.id}')" style="margin-right: 5px;">Logs</button>
                    ${(job.status === 'PROCESSING' || job.status === 'QUEUED') ? 
                        `<button class="btn-small" onclick="pauseJob('${job.id}')">Pause</button>
                         <button class="btn-small" onclick="cancelJob('${job.id}')">Cancel</button>` : 
                      job.status === 'PAUSED' ? 
                        `<button class="btn-small" onclick="resumeJob('${job.id}')">Resume</button>
                         <button class="btn-small" onclick="cancelJob('${job.id}')">Cancel</button>` :
                        `<button class="btn-small" onclick="removeJob('${job.id}')">Remove</button>
                         <button class="btn-small" onclick="deleteFileAndJob('${job.id}')" style="background-color: var(--accent-red);">Delete File</button>`
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

    window.deleteFileAndJob = function(jobId) {
        if(confirm("Are you sure you want to delete the job and the resulting file from disk?")) {
            fetch(`/api/jobs/${jobId}?delete_file=true`, { method: 'DELETE' });
        }
    };

    window.viewLogs = function(jobId) {
        fetch(`/api/jobs/${jobId}/logs`)
            .then(res => res.json())
            .then(data => {
                const logsContent = document.getElementById('logsContent');
                if (data.error) {
                    logsContent.textContent = "Error: " + data.error;
                } else {
                    logsContent.textContent = data.logs || "No logs available.";
                }
                document.getElementById('logsModal').style.display = 'flex';
            })
            .catch(err => {
                document.getElementById('logsContent').textContent = "Failed to load logs: " + err;
                document.getElementById('logsModal').style.display = 'flex';
            });
    };

    document.getElementById('btnCloseLogs').addEventListener('click', () => {
        document.getElementById('logsModal').style.display = 'none';
    });

});

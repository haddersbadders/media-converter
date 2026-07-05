# SPECIFICATION: Modern Media Explorer & Transcoder Dashboard

This document details the architectural specifications, user experience patterns, and backend structures for an advanced, self-hosted web system designed to browse local directories, inspect media metadata, configure parameters, and monitor active transcoding queues.

## 1. Executive Summary

The **Media Explorer & Transcoder** is a lightweight, high-performance web dashboard. It replaces raw CLI-based FFmpeg commands with a cohesive single-page application (SPA).

### Key High-Level Goals

- **Responsiveness**: Instant UI transitions, smooth directory traversing, and real-time transcode progress bars.
    
- **Robust Queue Management**: Asynchronous parallel processing with active state tracking, avoiding server lockups.
    
- **Sleek UX (Antigravity Theme)**: A modern Material Design layout utilizing floating cards, crisp typography, clean status badges, and subtle layout transitions.
    
- **Portable Deployment**: Packaged as a lightweight Docker container mapping host storage volumes, simplifying dependencies and installation on any environment.
    

## 2. Core Functional Features

### 2.1 Directory Browsing

The system must support rich traversal of `/opt/converter/media` without refreshing the web app.

- **Breadcrumb Navigation**: Interactive header showing the current relative path (e.g., `Home > SciFi > Season 1`) where each node is clickable.
    
- **Inline Directory Folder Trees**: Show both directories (represented as stylized folder icons) and media files side-by-side. Clicking a directory updates the explorer scope.
    
- **Virtual Folder Nesting**: Allow folder creation directly from the UI to target transcode output storage.
    
- **Up-one-level Control**: A clear `..` escape route to traverse back to root directories safely.
    

### 2.2 Media Details View

Selecting a file reveals an inspect drawer containing extensive stream properties extracted via `ffprobe`:

- **General Stats**: File path, raw size, total duration, container format, and global bitrate.
    
- **Video Streams**: Resolution (width x height), aspect ratio, codec profile, frame rate (FPS), color space (e.g., yuv420p), and pixel format.
    
- **Audio Streams**: Codec, sample rate (Hz), channel layout (Stereo, 5.1, Mono), and language tags.
    
- **Subtitle Streams**: Format, language, and default status tags.
    
- **Inline Player**: A basic HTML5 `<video>` preview component to verify source file validity on supported browser formats.
    

### 2.3 Monitor Transcodes

Converting video is resource-intensive and long-running. The UI must feature an active **Job Queue Panel**:

- **Live Progress Tracking**: Real-time progress percentages calculated by parsing FFmpeg's frame output against total video frames.
    
- **Key Metrics**: Display current processing speed (e.g., `2.3x`), frames-per-second conversion rate, target file size growth, and calculated ETA.
    
- **Queue Controller**: Ability to Pause, Resume, or Cancel/Kill an active transcoding job.
    
- **Job States**:
    
    - `Queued`: Awaiting CPU resources.
        
    - `Processing`: Active FFmpeg loop.
        
    - `Completed`: File written successfully. Includes dynamic details (e.g., "Size reduced by 40%").
        
    - `Failed`: Errored logs collected from stdout/stderr.
        
- **Persistent History Log**: A scrollable ledger of past conversions with their status indicators.
    

### 2.4 Transcode Settings

A settings sub-panel or drawer allows selection of standard profiles and fine-tuning output rules:

- **Pre-configured Presets**:
    
    - _Universal Web (H.264/AAC)_: High compatibility across all browsers and iOS/Android devices.
        
    - _Space Saver (H.265/HEVC)_: Extremely low bitrates, high compression.
        
    - _High Quality (CRF 18 / Pro)_: Retains maximum visual fidelity.
        
    - _Audio-Only extractor_: Converts container audio streams into lightweight `.mp3` or `.m4a` files.
        
- **Custom Configuration Parameters**:
    
    - **Video**: Codec select (`libx264`, `libx265`, `copy`), CRF (Constant Rate Factor, scale `0-51`), Resolution override (`Keep Original`, `1080p`, `720p`, `480p`).
        
    - **Audio**: Codec select (`aac`, `mp3`, `copy`), Audio channels (`Stereo`, `Keep Original`).
        
    - **Filename Rules**: Custom suffix formatting (e.g., `[OriginalName]_transcoded.[ext]`).
        

### 2.5 Dynamic Search & Filter

An instant search input on the main toolbar:

- **Fuzzy Filtering**: Instantly filters the active directory listing or the entire catalog (toggleable scope) as the user types.
    
- **Fast Filter Pills**: Quick-toggle buttons to filter list items by attributes:
    
    - Extensions (e.g., `.mkv` only, `.mp4` only)
        
    - Low resolution vs HD (e.g., `< 1080p`, `>= 1080p`)
        
    - Transcode status (e.g., "Exclude already transcoded files")
        

## 3. System Architecture & Tech Stack

```
                     ┌──────────────────────────────┐
                     │     Browser Client (UI)      │
                     │  - Material Dashboard Theme  │
                     │  - EventStreams progress     │
                     └──────────────┬───────────────┘
                                    │ HTTP / SSE
                                    ▼
                     ┌──────────────────────────────┐
                     │      Flask Web Server        │
                     │  - REST API / Route handlers │
                     │  - Directory walker & cache  │
                     └──────────────┬───────────────┘
                                    │ Read/Write Job State
                                    ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │                        Active Job Manager                         │
  │  - ThreadPoolExecutor (max_workers=2)                             │
  │  - FFmpeg Subprocess controllers                                  │
  │  - Real-time Output Parsers (logs frames -> computes progress)    │
  └───────────────────────────────────────────────────────────────────┘
```

### 3.1 Backend

- **Python 3.14**: Run within the isolated virtual environment (`/opt/converter/venv`).
    
- **Flask + Waitress**: Robust, lightweight WSGI setup handling non-blocking background routines.
    
- **Subprocess Pipelines**: Utilizing asynchronous pipes (`subprocess.Popen`) to interact with system `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` packages.
    
- **Real-time Server Push**: Utilize **Server-Sent Events (SSE)** via a `/queue/stream` route to push background task percentages and ETA updates directly to the browser UI without polling.
    

### 3.2 Database & Persistence

- **SQLite / Lightweight JSON file**: Since we need persistent queue states across server reboots, active and historic jobs are written to a lightweight local SQLite database file located at `/opt/converter/db.sqlite`.
    

### 3.3 Containerization Model (Docker)

- **Isolated Environment**: The application runtime, Python engine, SQLite layer, and standard `ffmpeg`/`ffprobe` system libraries are encapsulated entirely within a single Docker image.
    
- **Storage Abstraction**: Host storage directories are exposed to the container dynamically using bind mounts, removing path-hardcoding constraints from the system.
    

## 4. Database & Data Structures

### 4.1 Job Queue Table

This schema maintains queue integrity, allowing the system to restore active/failed jobs on restart.

| **Field Name** | **Type** | **Description** |

| `id` | TEXT (UUID) | Unique primary key identifying the task. |

| `filename` | TEXT | Relative path of the input file. |

| `output_path` | TEXT | System destination where the file is being written. |

| `status` | TEXT | `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED` |

| `progress` | REAL | Current calculated percentage progress (0.0 to 100.0). |

| `speed` | TEXT | Real-time conversion velocity string (e.g., `1.8x`). |

| `eta` | TEXT | Calculated remaining time (e.g., `00:04:12`). |

| `settings` | TEXT | JSON string recording the preset options used. |

| `created_at` | DATETIME | Timestamp of job creation. |

## 5. UI Layout Blueprint (Google Antigravity Aesthetic)

The user interface leverages a clean, high-contrast, double-pane viewport.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ▲ ANTIGRAVITY CODES | Media Explorer & Transcoder               [System Load: 14%]   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Breadcrumb: Home / Movies / SciFi                               [ Search Files... ]  │
├───────────────────────────────┬──────────────────────────────────────────────────────┤
│  📂 DIRECTORIES & FILES       │  ⚙️ TRANSCODE CONSOLE                                │
│                               │  ──────────────────────────────────────────────────  │
│  [..] (Parent Directory)      │  Selected: Matrix.mkv                                │
│  📁 Action                    │  Codec: h264 | Res: 1920x1080 | Size: 1.4 GB         │
│  📁 Drama                     │                                                      │
│  🎬 BladeRunner.mkv   (850MB) │  Preset Profiles:                                    │
│  🎬 Dune_2024.avi     (2.4GB) │  ┌────────────────────────────────────────────────┐  │
│  🎬 Matrix.mkv        (1.4GB) │  │ ● Universal Web Compatibility H.264 (MP4)       │  │
│                               │  │ ○ Ultra Compact H.265 Space Saver (HEVC)        │  │
│                               │  │ ○ Lossless High Fidelity Master (CRF 18)        │  │
│                               │  └────────────────────────────────────────────────┘  │
│                               │  [ Transcode Now ]   [ Save Preset ]                 │
├───────────────────────────────┴──────────────────────────────────────────────────────┤
│  📊 ACTIVE QUEUE & MONITOR                                                           │
│  ──────────────────────────────────────────────────────────────────────────────────  │
│  [Processing] Dune_2024.avi  =======> [ 45.2% ]  Speed: 2.1x  ETA: 02:14  [ Cancel ] │
│  [Queued]     BladeRunner.mkv  (Waiting in pipeline queue)               [ Remove ]  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### UI Micro-Interactions

1. **Header Cards**: Dynamic feedback with status glow lines changing color based on system CPU loads.
    
2. **Dynamic Badges**: Highlighting specific source video codecs in bright neon tags (`HEVC` in Purple, `AVC` in Cyan, `MPEG-2` in Amber) so unoptimized containers stand out at a glance.
    
3. **Smooth Slide Drawer**: Clicking details triggers a flyout card showcasing the streams list.
    

## 6. Docker Deployment Blueprint

To deploy this application seamlessly, the project uses a multi-stage `Dockerfile` and a simple orchestration wrapper via `docker-compose.yml`.

### 6.1 Dockerfile Structure

The build uses a stable debian-slim Python base image to keep the footprint small, while cleanly loading stable FFmpeg binary packages.

```
# Multi-stage build to minimize production runtime image size
FROM python:3.14-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set up runtime directory
WORKDIR /app

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code files
COPY app.py .

# Expose internal web port
EXPOSE 5000

# Run using production-grade waitress server
CMD ["waitress-serve", "--host=0.0.0.0", "--port=5000", "--threads=4", "app:app"]
```

### 6.2 docker-compose.yml Specification

Using Compose allows the host storage and database directory to be mounted securely.

```
version: '3.8'

services:
  transcoder:
    build: .
    container_name: media-transcoder
    ports:
      - "5000:5000"
    volumes:
      # Map the host media folder (e.g. /opt/converter/media) to the internal media directory
      - /opt/converter/media:/opt/converter/media
      # Map the persistence directory for SQLite storage
      - ./data:/opt/converter/data
    environment:
      - MEDIA_DIR=/opt/converter/media
      - DB_PATH=/opt/converter/data/db.sqlite
    restart: unless-stopped
```

## 7. Development Phased Roadmap

### Phase 1: Storage & Traversal Engine (Filesystem API)

- Build recursion methods that cleanly generate a directory tree dictionary structure.
    
- Construct directory endpoints supporting pagination and navigation payloads.
    

### Phase 2: FFmpeg Process Monitor Engine (Parser)

- Write an asynchronous subprocess log reader that reads FFmpeg output streams.
    
- Implement regex parsers to match patterns like `frame=\s*(\d+)` and `speed=\s*([\d\.]+)x`.
    
- Correlate output frames with source metadata frame counts to determine progress.
    

### Phase 3: Queue Management System

- Establish a pool of thread executor workers (default limit of 1 or 2 concurrent transcodes to avoid locking up Ubuntu CPU cores).
    
- Hook state changes into the SQLite backend.
    

### Phase 4: Modern Antigravity Front-end

- Code the full client-side HTML structure.
    
- Add Javascript-based directory routing, search index matching, and Server-Sent Event listeners to continuously update elements.
    
- Style with elegant Material cards and responsive spacing.
    

### Phase 5: Containerization & Docker Deployment

- Draft requirements configurations and write the multi-stage system Dockerfile.
    
- Build cross-platform images optimized for x86_64 and arm64 (for single-board server hosting).
    
- Implement container initialization test scripts to verify permission configurations on mapped volumes.
# Multi-stage build to minimize production runtime image size
FROM python:3.12-slim AS base

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
COPY . .

# Expose internal web port
EXPOSE 5000

# Run using production-grade waitress server
CMD ["waitress-serve", "--host=0.0.0.0", "--port=5000", "--threads=4", "app:app"]

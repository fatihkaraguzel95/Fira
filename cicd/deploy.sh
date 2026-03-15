#!/bin/bash
# -----------------------------------------------
# Fira — Deploy Script
# Triggered by webhook on every push to main
# -----------------------------------------------

set -e  # Exit immediately on any error

FIRA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="/var/www/fira"
LOG_FILE="/var/log/fira-deploy.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

log() {
  echo "[$TIMESTAMP] $1" | tee -a "$LOG_FILE"
}

log "========== Deploy started =========="

# 1. Pull latest code
log "Pulling latest code from GitHub..."
cd "$FIRA_DIR"
git pull origin main >> "$LOG_FILE" 2>&1

# 2. Install dependencies
log "Installing dependencies..."
npm install --legacy-peer-deps >> "$LOG_FILE" 2>&1

# 3. Build
log "Building..."
npm run build >> "$LOG_FILE" 2>&1

# 4. Copy to web root
log "Copying dist to $WEB_DIR..."
sudo mkdir -p "$WEB_DIR"
sudo cp -r dist/* "$WEB_DIR/"

log "========== Deploy finished =========="

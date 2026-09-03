#!/usr/bin/env bash
set -euo pipefail

# Open Project Manager Updater for Raspberry Pi / Linux
# Location: /opt/open-project-manager/update.sh

INSTALL_DIR="/opt/open-project-manager"
SERVICE_NAME="open-project-manager"
BACKUP_DIR="${INSTALL_DIR}/backups"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

cd "${INSTALL_DIR}"

CURRENT_VERSION=$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD)

show_usage() {
    echo "Open Project Manager - Update Utility"
    echo ""
    echo "Usage:"
    echo "  ./update.sh [options] [TAG_OR_BRANCH]"
    echo ""
    echo "Options:"
    echo "  -l, --list       List remote tags and current deployed version"
    echo "  -c, --current    Show current deployed tag/commit"
    echo "  -h, --help       Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./update.sh --list             # View all available versions"
    echo "  ./update.sh main               # Update to latest main branch"
    echo "  ./update.sh v0.2.0             # Update to a specific tag"
    echo ""
}

list_versions() {
    info "Fetching latest tags from remote repository..."
    git fetch --tags origin --quiet 2>/dev/null || true
    echo ""
    echo -e "Currently deployed version: ${GREEN}${CURRENT_VERSION}${NC}"
    echo ""
    echo "Available remote tags (newest first):"
    TAGS=$(git tag -l --sort=-v:refname)
    if [ -z "$TAGS" ]; then
        echo "  (No tags found upstream. You can update using branch: 'main')"
    else
        echo "$TAGS" | while read -r tag; do
            if [ "$tag" = "$CURRENT_VERSION" ]; then
                echo -e "  * ${GREEN}${tag}${NC} (current)"
            else
                echo -e "    ${tag}"
            fi
        done
    fi
    echo ""
}

# Parse flag options
if [ $# -ge 1 ]; then
    case "$1" in
        -h|--help)
            show_usage
            exit 0
            ;;
        -l|--list)
            list_versions
            exit 0
            ;;
        -c|--current)
            echo "Current version: ${CURRENT_VERSION}"
            exit 0
            ;;
    esac
fi

TARGET_REF="${1:-}"

if [ -z "$TARGET_REF" ]; then
    list_versions
    read -rp "Enter tag or branch to update to (e.g. main or v0.2.0) [leave blank to cancel]: " USER_INPUT
    if [ -z "$USER_INPUT" ]; then
        info "Update cancelled."
        exit 0
    fi
    TARGET_REF="$USER_INPUT"
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DB="${BACKUP_DIR}/dev.db.${TIMESTAMP}.bak"
BACKUP_ENV="${BACKUP_DIR}/.env.${TIMESTAMP}.bak"
PREV_COMMIT=$(git rev-parse HEAD)

cleanup_on_failure() {
    error "Update failed! Rolling back changes..."
    if [ -f "${BACKUP_DB}" ]; then
        info "Restoring database from ${BACKUP_DB}..."
        cp "${BACKUP_DB}" "${INSTALL_DIR}/dev.db"
    fi
    if [ -f "${BACKUP_ENV}" ]; then
        cp "${BACKUP_ENV}" "${INSTALL_DIR}/.env"
    fi
    info "Reverting git commit to ${PREV_COMMIT}..."
    git checkout --quiet "${PREV_COMMIT}" 2>/dev/null || true
    info "Attempting to restart ${SERVICE_NAME}..."
    sudo systemctl restart "${SERVICE_NAME}" || true
    error "Rollback complete. Please check the logs above."
}

trap cleanup_on_failure ERR

info "=== Starting Open Project Manager Update ==="
info "Current version: ${CURRENT_VERSION}"
info "Target version : ${TARGET_REF}"

# 1. Pre-flight checks
mkdir -p "${BACKUP_DIR}"

if ! grep -q "swap" /proc/swaps 2>/dev/null; then
    warn "No active swap detected. Enabling /swapfile_build if available..."
    if [ -f "/swapfile_build" ]; then
        sudo /sbin/swapon /swapfile_build || true
    fi
fi

# 2. Atomic SQLite and .env backup
if [ -f "${INSTALL_DIR}/dev.db" ]; then
    info "Creating atomic backup of SQLite database to ${BACKUP_DB}..."
    sqlite3 "${INSTALL_DIR}/dev.db" ".backup '${BACKUP_DB}'"
    if [ ! -s "${BACKUP_DB}" ]; then
        error "Backup failed or file is empty. Aborting update for safety."
        exit 1
    fi
    success "Database backup verified ($(du -h "${BACKUP_DB}" | cut -f1))."
fi

if [ -f "${INSTALL_DIR}/.env" ]; then
    cp "${INSTALL_DIR}/.env" "${BACKUP_ENV}"
    info "Environment configuration backed up to ${BACKUP_ENV}."
fi

# 3. Git Fetch & Checkout
info "Fetching upstream updates..."
git fetch --tags origin

info "Preparing clean working tree for checkout..."
git reset --hard HEAD --quiet
git clean -fd -e ".env*" -e "dev.db*" -e "backups*" -e "update.sh" -e "docs*" --quiet

if git show-ref --verify --quiet "refs/tags/${TARGET_REF}"; then
    info "Checking out tag: ${TARGET_REF}..."
    git checkout --force "tags/${TARGET_REF}"
elif git show-ref --verify --quiet "refs/tags/v${TARGET_REF}"; then
    info "Checking out tag: v${TARGET_REF}..."
    git checkout --force "tags/v${TARGET_REF}"
elif git show-ref --verify --quiet "refs/remotes/origin/${TARGET_REF}"; then
    info "Checking out branch: ${TARGET_REF}..."
    git checkout --force "${TARGET_REF}"
    git reset --hard "origin/${TARGET_REF}"
else
    info "Attempting git checkout: ${TARGET_REF}..."
    git checkout --force "${TARGET_REF}"
fi

# 4. Patch offline fonts if upstream reintroduced next/font/google
if grep -q "next/font/google" src/app/layout.tsx 2>/dev/null; then
    info "Patching layout.tsx for offline self-hosted fonts..."
    sed -i '/import { Geist/d' src/app/layout.tsx
    sed -i '/const geistSans/,/});/d' src/app/layout.tsx
    sed -i '/const geistMono/,/});/d' src/app/layout.tsx
    sed -i 's/\${geistSans.variable} \${geistMono.variable} //g' src/app/layout.tsx
fi

# 5. Ensure smart cookie security if upstream tag lacks it
if grep -q 'secure: process.env.NODE_ENV === "production"' src/lib/auth.ts 2>/dev/null; then
    info "Applying smart cookie security patch..."
    sed -i 's/secure: process.env.NODE_ENV === "production"/secure: process.env.COOKIE_SECURE === "false" ? false : process.env.NODE_ENV === "production"/' src/lib/auth.ts
fi
if [ -f "src/app/api/v1/auth/oidc/login/route.ts" ] && grep -q 'secure: process.env.NODE_ENV === "production"' src/app/api/v1/auth/oidc/login/route.ts 2>/dev/null; then
    sed -i 's/secure: process.env.NODE_ENV === "production"/secure: process.env.COOKIE_SECURE === "false" ? false : process.env.NODE_ENV === "production"/' src/app/api/v1/auth/oidc/login/route.ts
fi
if grep -q "next/font/google" src/app/layout.tsx 2>/dev/null; then
    info "Patching layout.tsx for offline self-hosted fonts..."
    sed -i '/import { Geist/d' src/app/layout.tsx
    sed -i '/const geistSans/,/});/d' src/app/layout.tsx
    sed -i '/const geistMono/,/});/d' src/app/layout.tsx
    sed -i 's/\${geistSans.variable} \${geistMono.variable} //g' src/app/layout.tsx
fi

# 5. Dependencies
info "Installing dependencies with frozen lockfile..."
yarn install --frozen-lockfile --network-timeout 300000

# 6. Database schema & Prisma Client
info "Generating Prisma Client..."
npx prisma generate

info "Deploying database migrations..."
npx prisma migrate deploy

# 7. Next.js Standalone Build
info "Compiling Next.js standalone application (memory limited to 2048MB)..."
NODE_OPTIONS="--max-old-space-size=2048" yarn build

info "Synchronizing standalone static assets..."
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
cp .env .next/standalone/.env
ln -sf "${INSTALL_DIR}/dev.db" .next/standalone/dev.db

# 8. Service Restart & Health Verification
info "Restarting ${SERVICE_NAME}..."
sudo systemctl restart "${SERVICE_NAME}"

info "Verifying service health..."
sleep 2

if sudo systemctl is-active --quiet "${SERVICE_NAME}"; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/login || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "307" ]; then
        success "Service is healthy and responding (HTTP ${HTTP_CODE})."
    else
        warn "Service is running, but HTTP response code was: ${HTTP_CODE}"
    fi
else
    error "Service failed to start! Check: journalctl -u ${SERVICE_NAME} -n 20"
    exit 1
fi

NEW_VERSION=$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD)

# Clear error trap before normal exit
trap - ERR

# Detect primary local network IP dynamically (works across Linux/macOS)
DETECTED_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || echo "")
LOCAL_HOSTNAME=$(hostname 2>/dev/null || echo "")
APP_PORT="${PORT:-3000}"

echo ""
success "========================================================="
success " Open Project Manager successfully updated to: ${NEW_VERSION}"
if [ -f "${BACKUP_DB}" ]; then
    success " Pre-update backup saved at: ${BACKUP_DB}"
fi
echo ""
info "Access Open Project Manager at:"
if [ -n "${DETECTED_IP}" ]; then
    echo "   - Local Network : http://${DETECTED_IP}:${APP_PORT}"
fi
if [ -n "${LOCAL_HOSTNAME}" ]; then
    echo "   - Hostname (mDNS): http://${LOCAL_HOSTNAME}.local:${APP_PORT}"
fi
echo "   - Localhost     : http://localhost:${APP_PORT}"

# Detect if HTTPS reverse proxy (Caddy / Nginx) is active
if command -v ss &>/dev/null; then
    if ss -tulpn 2>/dev/null | grep -qE ":(8443|443)\b"; then
        PROXY_PORT=$(ss -tulpn 2>/dev/null | grep -oE ":(8443|443)\b" | head -n1 | tr -d ':')
        if [ "$PROXY_PORT" = "443" ]; then
            [ -n "${DETECTED_IP}" ] && echo "   - HTTPS (Proxy) : https://${DETECTED_IP}"
            [ -n "${LOCAL_HOSTNAME}" ] && echo "   - HTTPS (Proxy) : https://${LOCAL_HOSTNAME}.local"
        else
            [ -n "${DETECTED_IP}" ] && echo "   - HTTPS (Proxy) : https://${DETECTED_IP}:${PROXY_PORT}"
            [ -n "${LOCAL_HOSTNAME}" ] && echo "   - HTTPS (Proxy) : https://${LOCAL_HOSTNAME}.local:${PROXY_PORT}"
        fi
    fi
fi
success "========================================================="
echo ""

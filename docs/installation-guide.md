# 🍓 Open Project Manager: Installation & Deployment Guide

A complete, production-ready tutorial for installing and self-hosting **Open Project Manager** on **Raspberry Pi** (ARM64/ARMv7), home servers, and Linux VPS environments.

---

## 📑 Table of Contents

1. [Overview & Architecture](#-overview--architecture)
2. [Hardware & OS Requirements](#-hardware--os-requirements)
3. [Prerequisites & System Preparation](#-prerequisites--system-preparation)
   - [Swap Configuration (Crucial for 1GB–2GB RAM Devices)](#swap-configuration-crucial-for-1gb2gb-ram-devices)
   - [Installing Node.js & Build Tools (Bare-Metal)](#installing-nodejs--build-tools-bare-metal)
4. [Deployment Mode 1: Docker & Docker Compose (Recommended)](#-deployment-mode-1-docker--docker-compose-recommended)
   - [Option A: SQLite (Zero-Config Default)](#option-a-sqlite-zero-config-default)
   - [Option B: PostgreSQL (Opt-In)](#option-b-postgresql-opt-in)
   - [Managing & Updating Docker Containers](#managing--updating-docker-containers)
5. [Deployment Mode 2: Bare-Metal / Standalone Node.js](#-deployment-mode-2-bare-metal--standalone-nodejs)
   - [Step 1: Clone & Configure Environment](#step-1-clone--configure-environment)
   - [Step 2: Install Dependencies & Build Standalone Bundle](#step-2-install-dependencies--build-standalone-bundle)
   - [Step 3: Initialize Database & Migrations](#step-3-initialize-database--migrations)
   - [Step 4: Configure Auto-Start Daemon (Systemd or PM2)](#step-4-configure-auto-start-daemon-systemd-or-pm2)
6. [Reverse Proxy & Automatic HTTPS (SSL)](#-reverse-proxy--automatic-https-ssl)
   - [Option A: Caddy (Recommended - Automatic SSL)](#option-a-caddy-recommended---automatic-ssl)
   - [Option B: Nginx + Certbot](#option-b-nginx--certbot)
7. [Backup, Restore & Maintenance](#-backup-restore--maintenance)
8. [Troubleshooting & FAQ](#-troubleshooting--faq)

---

## 🔍 Overview & Architecture

Open Project Manager is designed to be lightweight, responsive, and resource-friendly:
- **Baseline Idle RAM**: **~78 MB** (SQLite mode).
- **Architecture**: Next.js (App Router), TypeScript, Tailwind CSS, Prisma ORM v7 with SQLite (`better-sqlite3`) or PostgreSQL (`pg`).
- **Deployment Choices**:
  - **Docker Compose**: Containerized, isolated, automated migrations, zero host dependency pollution.
  - **Bare-Metal / Standalone**: Runs directly on Node.js using Next.js standalone output, delivering minimum overhead and fast startup on low-power devices.

---

## 🍓 Hardware & OS Requirements

| Component | Minimum | Recommended |
|---|---|---|
| **Hardware** | Raspberry Pi 3 Model B/B+ | Raspberry Pi 4 (2GB+) or Raspberry Pi 5 |
| **Architecture** | `armv7l` (32-bit) / `aarch64` (64-bit) | `aarch64` (64-bit ARM) |
| **RAM** | 1 GB (requires 2GB swap for builds) | 2 GB to 8 GB |
| **Storage** | 8 GB Class 10 MicroSD | 16 GB+ A2 MicroSD or USB 3.0 / NVMe SSD |
| **Operating System** | Raspberry Pi OS Lite (64-bit Bookworm), Debian 12, Ubuntu Server 22.04/24.04 |

> [!TIP]
> **64-bit OS Recommended**: Always install the **64-bit (aarch64)** version of Raspberry Pi OS or Ubuntu Server for best Node.js and Docker performance and compatibility.

---

## 🛠️ Prerequisites & System Preparation

Update your system packages before getting started:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl openssl
```

### Swap Configuration (Crucial for 1GB–2GB RAM Devices)

> [!WARNING]
> Building Next.js applications (`yarn build` / Next.js compilation) requires ~1.5 GB of peak memory during TypeScript validation and minification. On 1GB or 2GB RAM Raspberry Pis, the build process will be killed by the Linux Out-Of-Memory (OOM) killer unless sufficient swap space is configured.

#### On Raspberry Pi OS:
Edit the swap configuration file:
```bash
sudo nano /etc/dphys-swapfile
```
Change `CONF_SWAPSIZE` to `2048` (2 GB):
```ini
CONF_SWAPSIZE=2048
```
Restart the swap service:
```bash
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

#### On Ubuntu / Debian:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# Make permanent across reboots:
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
Verify swap is active:
```bash
free -h
```

---

### Installing Node.js & Build Tools (Bare-Metal)

If you plan to run Open Project Manager directly without Docker (Mode 2), install **Node.js 22 LTS**, **Yarn**, and C++ compilation tools for native SQLite bindings:

```bash
# 1. Install C++ build tools (required for better-sqlite3 native bindings)
sudo apt install -y build-essential python3 make g++

# 2. Install Node.js 22.x LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Enable Corepack & Yarn
sudo corepack enable
corepack prepare yarn@stable --activate

# 4. Verify versions
node -v   # Should be v22.x.x
yarn -v   # Should be v1.22.x or modern Yarn
```

---

## 🐳 Deployment Mode 1: Docker & Docker Compose (Recommended)

Docker provides an isolated, reproducible container environment with automated schema migrations on startup.

### 1. Install Docker & Docker Compose on Raspberry Pi
```bash
# Install Docker using the official automated script
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add current user to docker group (so you don't need 'sudo' for docker commands)
sudo usermod -aG docker $USER

# Log out and log back in, or run:
newgrp docker

# Verify installation
docker compose version
```

### 2. Clone the Repository
```bash
git clone https://github.com/jciccio/open-project-manager.git
cd open-project-manager
```

### 3. Generate Secret Key
Create a `.env` file with a cryptographically secure `JWT_SECRET`:
```bash
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
```

*(Optional)* If you use an OpenID Connect (OIDC) identity provider (e.g. Authentik, Keycloak, Authelia), append your credentials:
```bash
cat <<EOT >> .env
OIDC_ISSUER_URL=https://idp.example.com
OIDC_CLIENT_ID=open-project-manager
OIDC_CLIENT_SECRET=your_client_secret
OIDC_REDIRECT_URI=https://opm.example.com/api/v1/auth/oidc/callback
EOT
```

---

### Option A: SQLite (Zero-Config Default)

The default `docker-compose.yml` runs a one-shot migration service (`prisma migrate deploy` against the `opm_data` volume) and then starts Open Project Manager.

```bash
# Start in the background
docker compose up -d
```

Check status and logs:
```bash
docker compose logs -f
```

The application is now live at: **`http://<RASPBERRY_PI_IP>:3000`**

---

### Option B: PostgreSQL (Opt-In)

For production setups using an integrated PostgreSQL 16 database:

```bash
# Start PostgreSQL and Open Project Manager
docker compose -f docker-compose.postgres.yml up -d
```

View logs:
```bash
docker compose -f docker-compose.postgres.yml logs -f
```

---

### Managing & Updating Docker Containers

#### Stop Services:
```bash
docker compose down
# Or for PostgreSQL:
docker compose -f docker-compose.postgres.yml down
```

#### Update to Latest Version:
```bash
git pull
docker compose build --pull
docker compose up -d
```

---

## ⚙️ Deployment Mode 2: Bare-Metal / Standalone Node.js

Bare-metal mode runs Next.js directly on the host using the standalone production bundle, providing minimal memory footprint (~78 MB RAM idle) and lightning-fast response times.

### Step 1: Clone & Configure Environment

```bash
# Clone to /opt or your home directory
sudo mkdir -p /opt/open-project-manager
sudo chown -R $USER:$USER /opt/open-project-manager
git clone https://github.com/jciccio/open-project-manager.git /opt/open-project-manager
cd /opt/open-project-manager

# Generate .env with JWT_SECRET
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
echo "DATABASE_URL=file:./dev.db" >> .env
echo "PORT=3000" >> .env
echo "HOSTNAME=0.0.0.0" >> .env
```

---

### Step 2: Install Dependencies & Build Standalone Bundle

```bash
# Install dependencies
yarn install --frozen-lockfile

# Generate Prisma Client
npx prisma generate

# Build Next.js standalone application with memory limit allocation
NODE_OPTIONS="--max-old-space-size=2048" yarn build

# Copy static assets into standalone output (required for Next.js standalone runtime)
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
```

---

### Step 3: Initialize Database & Migrations

```bash
# Apply Prisma database migrations
npx prisma migrate deploy

# (Optional) Seed demo user accounts and sample project boards
npx tsx prisma/seed.ts
```

---

### Step 4: Configure Auto-Start Daemon (Systemd or PM2)

To keep Open Project Manager running 24/7 and automatically restart it on Raspberry Pi reboots, choose either **Systemd** (recommended for Linux) or **PM2**.

#### Method A: Systemd Service (Recommended)

1. Copy the provided systemd service unit template from `deploy/open-project-manager.service`:
   ```bash
   sudo cp deploy/open-project-manager.service /etc/systemd/system/open-project-manager.service
   ```

2. If you are running under a custom user (e.g. `pi`) or cloned to a path other than `/opt/open-project-manager`, edit the service file:
   ```bash
   sudo nano /etc/systemd/system/open-project-manager.service
   ```
   *Verify `User=`, `Group=`, `WorkingDirectory=`, and `ExecStart=` paths.*

3. Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now open-project-manager
   ```

4. Check status & logs:
   ```bash
   # Check service status
   sudo systemctl status open-project-manager

   # Follow real-time application logs
   journalctl -u open-project-manager -f
   ```

#### Method B: PM2 Process Manager

1. Install PM2 globally:
   ```bash
   sudo npm install -g pm2
   ```

2. Start Open Project Manager using the pre-configured ecosystem file:
   ```bash
   pm2 start deploy/ecosystem.config.js
   ```

3. Save process list and enable auto-start on boot:
   ```bash
   pm2 save
   pm2 startup
   # (Run the sudo env command generated by pm2 startup)
   ```

4. Monitor with PM2:
   ```bash
   pm2 status
   pm2 logs open-project-manager
   ```

---

## 🔒 Reverse Proxy & Automatic HTTPS (SSL)

Running Open Project Manager behind a reverse proxy lets you access the app on standard HTTP (80) and HTTPS (443) ports, use a custom domain or `.local` hostname, and enjoy automated TLS encryption.

### Option A: Caddy (Recommended - Automatic SSL)

[Caddy](https://caddyserver.com/) is a modern web server that automatically provisions and renews SSL certificates from Let's Encrypt with zero manual configuration.

1. **Install Caddy**:
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update
   sudo apt install -y caddy
   ```

2. **Configure Caddyfile**:
   Copy the pre-configured template:
   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   ```
   Edit `/etc/caddy/Caddyfile` and replace `opm.example.com` with your actual domain or local IP:
   ```caddy
   opm.yourdomain.com {
       reverse_proxy localhost:3000
   }
   ```

3. **Restart Caddy**:
   ```bash
   sudo systemctl restart caddy
   ```

---

### Option B: Nginx + Certbot

1. **Install Nginx & Certbot**:
   ```bash
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```

2. **Configure Nginx Site**:
   Copy the template from `deploy/nginx.conf`:
   ```bash
   sudo cp deploy/nginx.conf /etc/nginx/sites-available/open-project-manager
   sudo ln -s /etc/nginx/sites-available/open-project-manager /etc/nginx/sites-enabled/
   ```
   Edit `/etc/nginx/sites-available/open-project-manager` and set `server_name` to your domain.

3. **Test and Reload Nginx**:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

4. **Obtain Free SSL Certificate**:
   ```bash
   sudo certbot --nginx -d opm.yourdomain.com
   ```

---

## 💾 Backup, Restore & Maintenance

### Backing Up SQLite Database (Hot Backup)

SQLite supports atomic hot backups while the application is actively running:

```bash
# Atomic online backup of dev.db
sqlite3 dev.db ".backup 'opm-backup-$(date +%Y%m%d_%H%M%S).db'"
```

To backup the entire deployment:
```bash
# Archive database, environment secret, and uploaded attachments
tar -czvf opm-backup-$(date +%Y%m%d).tar.gz dev.db .env
```

### Backing Up PostgreSQL Database

```bash
pg_dump -U postgres -h localhost -d opm -F c -b -v -f "opm-postgres-$(date +%Y%m%d).dump"
```

### Upgrading Open Project Manager (Bare-Metal)

To upgrade your bare-metal installation when a new version is released:

```bash
cd /opt/open-project-manager

# 1. Pull latest code
git pull origin main

# 2. Install dependencies & apply database migrations
yarn install --frozen-lockfile
npx prisma migrate deploy

# 3. Rebuild Next.js standalone bundle
NODE_OPTIONS="--max-old-space-size=2048" yarn build
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/

# 4. Restart service
sudo systemctl restart open-project-manager
# (Or if using PM2: pm2 restart open-project-manager)
```

---

## 🩺 Troubleshooting & FAQ

### Q1: Next.js build failed with `JavaScript heap out of memory` or `SIGKILL 137`
**Cause**: Node.js exhausted available RAM during the build phase on Raspberry Pi.  
**Solution**:
1. Ensure swap is enabled (at least 2GB). See [Swap Configuration](#swap-configuration-crucial-for-1gb2gb-ram-devices).
2. Execute the build with Node memory limit parameter:
   ```bash
   NODE_OPTIONS="--max-old-space-size=2048" yarn build
   ```

### Q2: Error compiling `better-sqlite3` during `yarn install`
**Cause**: Missing C++ compilation tools or Python.  
**Solution**:
Install build dependencies:
```bash
sudo apt install -y build-essential python3 make g++
yarn install --force
```

### Q3: `EACCES: permission denied` on database file in Docker
**Cause**: The named volume or host directory was created as root before the non-root `nextjs` user (UID 1001) could access it.  
**Solution**:
Use the standard `docker-compose.yml` which runs the `migrator` service as UID 1001 with correct volume initialization.

### Q4: How do I reduce MicroSD card wear on my Raspberry Pi?
**Solution**:
1. SQLite WAL mode (Write-Ahead Logging) is enabled by default, which performs efficient sequential disk writes.
2. For high write volumes, mount `/opt/open-project-manager` or the Docker data volume (`opm_data`) on an external USB 3.0 SSD or NVMe drive.
3. Keep automated daily backups using the SQLite `.backup` command.

---

## 🚀 You're All Set!

Open your browser at `http://<YOUR_PI_IP>:3000` (or `https://opm.yourdomain.com`), sign in with the admin credentials, and enjoy your self-hosted project manager!

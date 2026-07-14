# Tardmart – Production Deployment Guide

## Prerequisites

- Linux VPS (Ubuntu 22.04 LTS recommended)
- Docker Engine ≥ 24 and Docker Compose plugin
- At least 1 GB RAM, 10 GB disk
- A domain name or static IP

### Install Docker (Ubuntu)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group membership to take effect
```

---

## 1. Get the Code

```bash
git clone https://github.com/samiah1504/project-duns.git /opt/tardmart
cd /opt/tardmart
```

---

## 2. Configure Environment Variables

```bash
cp .env.production.example .env
nano .env          # or: vim .env
```

Fill in every `CHANGE_THIS_*` value:

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | Strong random password for the database |
| `DATABASE_URL` | Must match `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| `SECRET_KEY` | 64-char random hex — generate with `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `CORS_ORIGINS` | Your domain, e.g. `http://192.168.1.100` or `https://tardmart.example.com` |

> **Never commit `.env` to version control.**

---

## 3. Build and Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This builds both the frontend (React → nginx) and the backend (FastAPI), then starts all services. Database tables and migrations are applied automatically on first start.

Check that everything is running:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=50
```

---

## 4. Create the First Admin User

Run the seed script once to create the initial admin account:

```bash
docker compose -f docker-compose.prod.yml exec api python seed.py
```

This creates a default admin user. **Change the admin password immediately after first login.**

---

## 5. Verify the Deployment

Open your browser and navigate to `http://YOUR_VPS_IP` (or your domain).

API health check:

```bash
curl http://YOUR_VPS_IP/api/health
# Expected: {"status":"ok","service":"tardmart-api"}
```

---

## 6. HTTPS with Let's Encrypt (Recommended)

Install Certbot and the nginx plugin on the host:

```bash
sudo apt install certbot python3-certbot-nginx -y
```

Or use a reverse proxy such as [Caddy](https://caddyserver.com/) or
[Traefik](https://traefik.io/) in front of the nginx container.

For a quick setup with Caddy placed in front of the frontend container,
change the frontend port in `docker-compose.prod.yml` to `127.0.0.1:8080:80`
and let Caddy handle TLS on port 443.

---

## 7. Updating the Application

```bash
cd /opt/tardmart
git pull origin main          # or your production branch
docker compose -f docker-compose.prod.yml up -d --build
```

The `--build` flag rebuilds changed images. Database migrations run automatically.

---

## 8. Backups

### Manual backup

```bash
./scripts/backup.sh
# Saves a gzip-compressed SQL dump to ./backups/
```

### Automated daily backup (cron)

```bash
crontab -e
```

Add:

```
0 2 * * * /opt/tardmart/scripts/backup.sh >> /var/log/tardmart-backup.log 2>&1
```

Backups older than 30 days are deleted automatically by the script.

### Restore from backup

```bash
./scripts/restore.sh backups/tardmart_20260701_020000.sql.gz
```

> **Warning:** Restore drops and recreates the database. Take a fresh backup first.

---

## 9. Viewing Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Individual services
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f frontend
docker compose -f docker-compose.prod.yml logs -f db
```

Log files are rotated automatically (20 MB max, 5 files for api; 10 MB / 3 files for others).

---

## 10. Stopping and Restarting

```bash
# Restart a single service
docker compose -f docker-compose.prod.yml restart api

# Stop everything (data is preserved in volumes)
docker compose -f docker-compose.prod.yml down

# Stop and remove volumes (DELETES ALL DATA — use only to wipe and start fresh)
docker compose -f docker-compose.prod.yml down -v
```

---

## Architecture

```
Browser
  │
  ▼
nginx (port 80)            ← frontend container
  ├── /          →  /usr/share/nginx/html  (React SPA)
  └── /api/*     →  api:8000  (proxy)
                              │
                              ▼
                         FastAPI (uvicorn)  ← api container
                              │
                              ▼
                         PostgreSQL          ← db container
                         (pgdata volume)
```

---

## Development vs Production

| | Development (`docker-compose.yml`) | Production (`docker-compose.prod.yml`) |
|---|---|---|
| Frontend | Vite dev server (HMR) on port 3000 | nginx serving built static files on port 80 |
| Backend | Source mounted + `--reload` | Built image, no reload |
| Env vars | Hard-coded in compose | Read from `.env` file |
| CORS | `*` (allow all) | Specific origin(s) from `CORS_ORIGINS` |
| Logging | Default | Structured, rotated JSON logs |

#!/usr/bin/env bash
# =============================================================
# Tardmart – PostgreSQL backup script
# Usage: ./scripts/backup.sh [output-dir]
# Default output dir: ./backups
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env from project root if it exists
ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE"
    set +a
fi

POSTGRES_DB="${POSTGRES_DB:-tardmart}"
POSTGRES_USER="${POSTGRES_USER:-tardmart}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

BACKUP_DIR="${1:-$ROOT_DIR/backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/tardmart_${TIMESTAMP}.sql.gz"

echo "📦 Backing up database '$POSTGRES_DB' …"

docker compose -f "$ROOT_DIR/$COMPOSE_FILE" exec -T db \
    pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
    | gzip > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✅ Backup saved to: $BACKUP_FILE ($SIZE)"

# Remove backups older than 30 days
find "$BACKUP_DIR" -name "tardmart_*.sql.gz" -mtime +30 -delete 2>/dev/null && true
echo "🧹 Old backups (>30 days) removed."

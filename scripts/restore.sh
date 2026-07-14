#!/usr/bin/env bash
# =============================================================
# Tardmart – PostgreSQL restore script
# Usage: ./scripts/restore.sh <backup-file.sql.gz>
# WARNING: This will REPLACE the current database contents.
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <backup-file.sql.gz>"
    exit 1
fi

BACKUP_FILE="$1"
if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "❌ File not found: $BACKUP_FILE"
    exit 1
fi

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

echo "⚠️  WARNING: This will DROP and recreate database '$POSTGRES_DB'."
read -r -p "Type 'yes' to continue: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted."
    exit 0
fi

echo "🔄 Restoring '$BACKUP_FILE' → '$POSTGRES_DB' …"

# Drop and recreate the database (need superuser; postgres user works)
docker compose -f "$ROOT_DIR/$COMPOSE_FILE" exec -T db \
    psql -U "$POSTGRES_USER" -c "DROP DATABASE IF EXISTS $POSTGRES_DB;" postgres

docker compose -f "$ROOT_DIR/$COMPOSE_FILE" exec -T db \
    psql -U "$POSTGRES_USER" -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;" postgres

# Restore
gunzip -c "$BACKUP_FILE" | docker compose -f "$ROOT_DIR/$COMPOSE_FILE" exec -T db \
    psql -U "$POSTGRES_USER" "$POSTGRES_DB"

echo "✅ Restore complete."
echo "ℹ️  Restart the api container to re-run migrations:"
echo "   docker compose -f $COMPOSE_FILE restart api"

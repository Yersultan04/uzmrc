#!/usr/bin/env bash
# Postgres backup for the rag-cms demo stack.
# Dumps the ragcms DB from the running container to ./backups/ragcms-<ts>.sql.gz.
# Usage: scripts/backup-db.sh [keep_n]   (keep_n: how many recent dumps to retain, default 7)
set -euo pipefail

CONTAINER="${PG_CONTAINER:-ragcms-postgres}"
DB="${POSTGRES_DB:-ragcms}"
USER="${POSTGRES_USER:-ragcms}"
KEEP="${1:-7}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
mkdir -p "$DIR"

# Timestamp from the container (host `date` is intentionally avoided for portability).
TS="$(docker exec "$CONTAINER" date -u +%Y%m%d-%H%M%S)"
OUT="$DIR/ragcms-$TS.sql.gz"

echo "Dumping $DB from $CONTAINER -> $OUT"
docker exec "$CONTAINER" pg_dump -U "$USER" "$DB" | gzip > "$OUT"
echo "Backup size: $(du -h "$OUT" | cut -f1)"

# Retention: keep the newest $KEEP dumps, delete the rest.
ls -1t "$DIR"/ragcms-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "Pruning old backup: $old"
  rm -f "$old"
done
echo "Done. Retained newest $KEEP dumps in $DIR."

#!/usr/bin/env bash
# migrate-to-kaneo.sh — Automates the Linear → Kaneo production migration
#
# Usage:
#   ./scripts/migrate-to-kaneo.sh [OPTIONS]
#
# Options:
#   --user <telegram_id>  Migrate only a specific user (default: all users)
#   --skip-backup         Skip SQLite backup step
#   --skip-dry-run        Skip the dry-run preview step
#   --no-clear-history    Keep conversation history after migration
#   --yes                 Non-interactive: skip confirmation prompt
#
# Prerequisites:
#   - docker compose v2 is available
#   - .env file is present and configured (KANEO_POSTGRES_PASSWORD, KANEO_AUTH_SECRET, KANEO_CLIENT_URL)
#   - Each user has kaneo_key, kaneo_base_url, kaneo_workspace_id set in papai.db
#     (set via /set kaneo_key ... etc. in Telegram before running this script)
#
# After the migration completes, each user must run:
#   /set kaneo_project_id <id>
# in the bot to set their default project.

set -euo pipefail

# --- Colours ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET} $*"; }
success() { echo -e "${GREEN}[OK]${RESET}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET} $*"; }
error()   { echo -e "${RED}[ERR]${RESET}  $*" >&2; }
die()     { error "$*"; exit 1; }

# --- Defaults ---
USER_FLAG=""
SKIP_BACKUP=false
SKIP_DRY_RUN=false
CLEAR_HISTORY=true
NON_INTERACTIVE=false

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      [[ -n "${2:-}" ]] || die "--user requires a telegram user ID"
      USER_FLAG="--user $2"
      shift 2
      ;;
    --skip-backup)    SKIP_BACKUP=true;      shift ;;
    --skip-dry-run)   SKIP_DRY_RUN=true;     shift ;;
    --no-clear-history) CLEAR_HISTORY=false; shift ;;
    --yes)            NON_INTERACTIVE=true;  shift ;;
    *) die "Unknown option: $1" ;;
  esac
done

COMPOSE_CMD="docker compose"

# --- Registration helpers ---
set_registration() {
  local value="$1"
  if grep -q '^KANEO_DISABLE_REGISTRATION=' .env 2>/dev/null; then
    sed -i "s/^KANEO_DISABLE_REGISTRATION=.*/KANEO_DISABLE_REGISTRATION=${value}/" .env
  else
    echo "KANEO_DISABLE_REGISTRATION=${value}" >> .env
  fi
  $COMPOSE_CMD up -d --force-recreate --no-deps kaneo
  info "Waiting for kaneo to be healthy..."
  local retries=20
  while [[ $retries -gt 0 ]]; do
    if docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q kaneo)" 2>/dev/null | grep -q healthy; then
      break
    fi
    sleep 3
    retries=$((retries - 1))
  done
  if [[ $retries -eq 0 ]]; then
    die "kaneo did not become healthy after restarting"
  fi
}

# Build migration script flags
MIGRATE_FLAGS="${USER_FLAG}"
if $CLEAR_HISTORY; then
  MIGRATE_FLAGS="${MIGRATE_FLAGS} --clear-history"
fi

# --- Step 0: Sanity checks ---
info "Checking prerequisites..."

command -v docker >/dev/null 2>&1 || die "docker not found"
docker compose version >/dev/null 2>&1 || die "docker compose v2 not found"
[[ -f ".env" ]] || die ".env file not found — copy .env.example and fill in values"

success "Prerequisites OK"

# --- Step 1: Dry run (preview) ---
if ! $SKIP_DRY_RUN; then
  echo ""
  echo -e "${BOLD}=== Step 1: Dry run preview ===${RESET}"
  info "Running migration in dry-run mode to preview what will be migrated..."
  echo ""

  $COMPOSE_CMD run --rm \
    -e DB_PATH=/data/papai.db \
    papai bun run src/scripts/migrate-linear-to-kaneo.ts --dry-run ${USER_FLAG} || \
    die "Dry run failed — check the output above and fix any issues before proceeding"

  echo ""
  warn "The above shows what WOULD be migrated. No data has been written yet."
else
  warn "Dry run skipped (--skip-dry-run)"
fi

# --- Step 2: Confirmation ---
if ! $NON_INTERACTIVE; then
  echo ""
  echo -e "${BOLD}=== Confirm migration ===${RESET}"
  echo ""
  echo "This will:"
  echo "  1. Back up papai.db to ./papai-pre-migration.db"
  echo "  2. Stop the papai bot"
  echo "  3. Run the LINEAR → KANEO migration"
  if $CLEAR_HISTORY; then
    echo "  4. Clear all conversation history and memory (use --no-clear-history to skip)"
  fi
  echo "  5. Start the papai bot"
  echo ""
  read -r -p "Proceed? [y/N] " CONFIRM
  [[ "${CONFIRM,,}" == "y" || "${CONFIRM,,}" == "yes" ]] || { info "Aborted."; exit 0; }
fi

# --- Step 3: Backup ---
if ! $SKIP_BACKUP; then
  echo ""
  echo -e "${BOLD}=== Step 2: Backup papai.db ===${RESET}"
  BACKUP_FILE="papai-pre-migration-$(date +%Y%m%d-%H%M%S).db"
  info "Copying papai.db → ${BACKUP_FILE}"
  docker run --rm \
    -v papai_papai-data:/data \
    -v "$(pwd):/backup" \
    alpine sh -c "cp /data/papai.db /backup/${BACKUP_FILE}" || \
    die "Backup failed — aborting migration"
  success "Backup saved to ${BACKUP_FILE}"
else
  warn "Backup skipped (--skip-backup)"
fi

# --- Step 4: Stop bot ---
echo ""
echo -e "${BOLD}=== Step 3: Stop papai ===${RESET}"
info "Stopping papai container..."
$COMPOSE_CMD stop papai
success "papai stopped"

# --- Step 5: Enable registration for provisioning ---
echo ""
echo -e "${BOLD}=== Step 4: Enable Kaneo registration ===${RESET}"
info "Temporarily enabling Kaneo registration for account provisioning..."
set_registration false
success "Registration enabled"

# --- Step 6: Run migration ---
echo ""
echo -e "${BOLD}=== Step 5: Run migration ===${RESET}"
info "Migrating data from Linear to Kaneo..."
echo ""

$COMPOSE_CMD run --rm \
  -e DB_PATH=/data/papai.db \
  papai bun run src/scripts/migrate-linear-to-kaneo.ts ${MIGRATE_FLAGS} || {
    MIGRATION_EXIT=$?
    error "Migration failed (exit code ${MIGRATION_EXIT})"
    echo ""
    warn "Disabling registration and attempting to restart papai..."
    set_registration true || true
    $COMPOSE_CMD start papai || true
    echo ""
    if ! $SKIP_BACKUP; then
      warn "Your backup is at: ${BACKUP_FILE:-papai-pre-migration.db}"
      warn "To restore: docker run --rm -v papai_papai-data:/data -v \$(pwd):/backup alpine sh -c 'cp /backup/${BACKUP_FILE:-papai-pre-migration.db} /data/papai.db'"
    fi
    exit ${MIGRATION_EXIT}
  }

success "Migration complete"

# --- Step 7: Disable registration ---
echo ""
echo -e "${BOLD}=== Step 6: Disable Kaneo registration ===${RESET}"
info "Locking down Kaneo registration..."
set_registration true
success "Registration disabled"

# --- Step 8: Start bot ---
echo ""
echo -e "${BOLD}=== Step 7: Start papai ===${RESET}"
info "Starting papai..."
$COMPOSE_CMD start papai
success "papai started"

# --- Done ---
echo ""
echo -e "${BOLD}${GREEN}=== Migration finished successfully ===${RESET}"
echo ""
echo "Next steps:"
echo "  1. Verify data in Kaneo: https://\${KANEO_CLIENT_URL}"
echo "  2. Ask each user to run: /set kaneo_project_id <id>"
echo "     To discover project IDs, run: /set kaneo_project_id (then use /list_projects in the bot)"
if $CLEAR_HISTORY; then
  echo "  3. Conversation history has been cleared — users start fresh with Kaneo context"
else
  echo "  3. Conversation history was NOT cleared — consider running /clear in the bot to avoid Linear ID confusion"
fi
echo ""
echo "  Admin can clear any user's history via Telegram:"
echo "    /clear <user_id>   — clear one user"
echo "    /clear all         — clear all users"
echo ""

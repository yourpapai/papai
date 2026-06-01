#!/usr/bin/env bash
set -euo pipefail

# Smoke-tests a freshly built papai Docker image. Asserts that:
#  - the container starts and stays up for at least 15 seconds
#  - the bot logs the "Starting papai..." info line
#  - the bot does NOT exit with a non-zero code within the first 15 seconds
#
# Required env: IMAGE_TAG, ADMIN_USER_ID (any non-empty value)
# Optional env: STARTUP_DEADLINE_SECONDS (default 15)

IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
ADMIN_USER_ID="${ADMIN_USER_ID:?ADMIN_USER_ID is required}"
DEADLINE="${STARTUP_DEADLINE_SECONDS:-15}"

if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
  echo "Image '$IMAGE_TAG' not found in local Docker daemon. Was it built in this job?"
  exit 1
fi

CONTAINER_NAME="papai-smoke-$$"
LOG_FILE="$(mktemp)"
cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

docker run --name "$CONTAINER_NAME" \
  -e "ADMIN_USER_ID=$ADMIN_USER_ID" \
  -e "DEBUG_SERVER=true" \
  -e "LOG_LEVEL=info" \
  -e "INSTANCE_CONFIG_KEY=$(printf '%064x' 1)" \
  -e "LLM_API_KEY=sk-smoke-test" \
  -e "LLM_BASE_URL=https://example.invalid" \
  -e "MAIN_MODEL=smoke-model" \
  -e "SETTINGS_PUBLIC_BASE_URL=https://settings.example.invalid" \
  "$IMAGE_TAG" \
  >"$LOG_FILE" 2>&1 &

# Poll the container: it must remain running for the entire deadline.
# Tolerate the first second for the container to leave the "created" state.
elapsed=0
while [ "$elapsed" -lt "$DEADLINE" ]; do
  state="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [ "$state" = "false" ]; then
    echo "Container exited early (after ${elapsed}s). Logs:"
    cat "$LOG_FILE"
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

# Assert the startup line is present.
if ! grep -q '"msg":"Starting papai..."' "$LOG_FILE"; then
  echo "Did not find startup log line. Logs:"
  cat "$LOG_FILE"
  exit 1
fi

# Assert no module-resolution or fatal errors. Pino emits level:60 for fatal;
# matching the literal "FATAL" was dropped because it false-positives on
# arbitrary substrings (e.g. inside a logged URL or stack frame).
if grep -qE 'Cannot find module|process\.exit\(1\)|"level":60' "$LOG_FILE"; then
  echo "Found fatal error in logs:"
  cat "$LOG_FILE"
  exit 1
fi

echo "Smoke test passed: container stayed up for ${DEADLINE}s, startup log present, no fatal errors."

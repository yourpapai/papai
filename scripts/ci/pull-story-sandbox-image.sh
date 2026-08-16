#!/usr/bin/env bash
set -euo pipefail

# Pulls the pinned Linux story-sandbox image into the runner's local Docker
# daemon, retrying a registry rejection before giving up.
#
# Every lane that touches the sandbox otherwise reaches Docker Hub from wherever
# it first runs `docker run` — including from inside a test, where an anonymous
# pull is rate-limited per runner IP and a bad minute at the registry reads as a
# failed assertion. Run 31932802512 is what that costs: the `Checks` job's suite
# died on `unauthorized: authentication required` at
# `tests/scripts/story-sandbox.test.ts`, three minutes after the `Hermetic
# Full-Stack Stories` job on another runner had pulled the same digest without
# trouble. Warmed here, the image is already local when a test runs `docker run`,
# and a registry that is genuinely down fails this step — named, and retried —
# rather than a boundary test that has nothing to say about the registry.
#
# The digest is read from the one file that owns it, never restated here:
# `scripts/story/sandbox-image.txt` (see tests/scripts/story-sandbox-image.test.ts).

image="$(cat scripts/story/sandbox-image.txt)"
if [ -z "$image" ]; then
  echo "scripts/story/sandbox-image.txt is empty; nothing to pull."
  exit 1
fi

attempts=3
for attempt in $(seq 1 "$attempts"); do
  if docker pull "$image"; then
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    delay=$((attempt * 10))
    echo "Pulling '$image' failed (attempt $attempt of $attempts); retrying in ${delay}s."
    sleep "$delay"
  fi
done

echo "Could not pull the pinned story sandbox image after $attempts attempts: $image"
exit 1

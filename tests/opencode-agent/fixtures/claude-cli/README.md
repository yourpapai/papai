<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# claude CLI fixture corpus — provenance

The decoders in `opencode-agent/src/claude-contract.ts` are tested against the
`.ndjson` files in this directory, and the workspace doctrine is **recorded,
never guessed** (the `live-sdk.integration.ts` rule: when the pin moves, re-run
the recorder rather than adjusting a decoder by inspection).

State of this directory:

- `auth-error-turn.ndjson` — **genuinely recorded** from `claude` 2.1.239 on
  2026-08-24, driven `--bare -p --output-format stream-json --verbose
--permission-mode default` with no credential set. An un-credentialed turn
  costs nothing and still emits the real `system`/`assistant`/`result` line
  shapes — with `is_error: true`, `terminal_reason: "api_error"` and exit code
  0, which is itself a load-bearing recorded fact: the error-to-non-zero-exit
  correlation is relied on for nothing.
- `success-turn.ndjson`, `adversarial-plan-bash-refused.ndjson`,
  `resume-turn.ndjson` — **provisional, documented shapes**. The credentialed
  recorder run (change task 1.2,
  `bun run opencode-agent:test:claude-live`) replaces the whole corpus with
  recordings from the live pinned CLI and stamps the exact CLI version into
  `VERSION` beside this file; `tests/opencode-agent/workflow.test.ts` then
  asserts that stamp equals the workflow's install pin. Until `VERSION` exists,
  these three files are shape-documentation, not observation.

The recorder is the only writer of this directory; nothing here is edited by
hand once recorded. One credentialed run (`bun run
opencode-agent:test:claude-live`) asserts the whole corpus's behaviours and
stamps `VERSION` (plus `facts.json` — the determinism findings); re-run it
with `CLAUDE_LIVE_REFRESH_FIXTURES=1` to mark the `.ndjson` corpus for
re-recording, and see the recorder's header for what each file must carry.

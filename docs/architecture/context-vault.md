<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Context Vault

External memory for coding sessions: an indexer running next to a coding agent pushes OpenSpec change files to the bot, which reduces them to summaries/outlines/stage/progress and exposes them to chat through two read-only plugin tools.

## Data flow

1. **Indexer** (`context-vault-indexer/`, agent-side) periodically scans configured spec dirs for `*.md`, diffs against a persisted `file → hash` map under its state dir, and pushes per-change deltas to `POST /api/context-vault/push` with a bearer token. Push failures retry with exponential backoff; state only advances for successfully pushed changes, so a restart re-pushes exactly the unacked delta.
2. **Push endpoint** (`src/context-vault/push-route.ts`) is mounted in the debug server's public capability lane before the auth gate — the vault token is the only credential. Unknown, revoked, and malformed tokens get a uniform 401; bodies are size-capped (1 MiB) and strictly validated.
3. **Storage** (migration `076_context_vault`, twin `src/db/context-vault-schema.ts`) keys everything by **config-context id**: `context_vault_tokens` (SHA-256 hash only, timing-safe verify, `last_used_at` misuse signal), `context_vault_specs` (one row per `repo:change-name` with one-line/summary/outline/stage/progress/mtime), `context_vault_files` (per-file hash ledger for idempotent upserts; equal-hash pushes are no-ops, deletions drop rows and empty spec shells), `context_vault_indexer_state` (`last_push_at` freshness meta).
4. **Reduction** (`src/context-vault/reducer.ts`) extracts the outline, the stage matrix (draft/approved/in-progress/done, `archive/` prefix counts as done), and checkbox progress from the pushed text before raw text is discarded — only `tasks.md`-class mechanical content is stored as hashes; semantic kinds (`proposal`/`design`/`plan`/`spec`) are summarized and dropped.
5. **Summarization** (`src/context-vault/summarizer.ts`) is a debounced in-process queue (15 s) that regenerates one-line + detailed summaries via the context's central/BYOK LLM config; failure keeps the previous summary, and a restart loses pending work (the next differing push re-enqueues; outline/stage/progress serve unsummarized specs meanwhile).
6. **Reads** (`plugins/context-vault/`) — two tools, `list_agent_specs` (repo/status/changedSince filters + `meta.lastPushAt`) and `get_agent_spec` (summary/outline/stage/progress + freshness; bare change names resolve only when unique across repos, else the candidate full ids are returned), gated by the `contextVault.read` facade permission and standard `tool_prefs` allow/ask/deny. Both are classified `read` risk in `TOOL_METADATA`, so they survive the guest read-only filter. The facade maps the raw thread-scoped storage-context id to the group config-context, so sibling threads share one vault, and no task instance is required.

## Indexer singleton

Coding-agent plugin lifecycles are per-session, so watching in-process would fork N watchers and race on push. Instead a thin adapter (`context-vault-indexer/adapters/opencode.ts`) performs a lock-file check on activation and spawns the daemon detached; it never scans or pushes in-process. The lock (`<stateDir>/context-vault-indexer.lock`, `{ pid, heartbeatAt }`) treats a live PID + fresh heartbeat as held, and reclaims on dead PID, expired heartbeat (TTL authoritative over PID liveness), or a corrupt record, via delete + exclusive re-create (`wx`), so concurrent contenders converge on exactly one daemon. The adapter acquires with its own short-lived pid only to serialize concurrent activations, then hands the record off to the spawned daemon's pid (`handoffIndexerLock`); the daemon owns the lock from then on and refreshes `heartbeatAt` on every scan tick (`refreshIndexerHeartbeat` in the `runDaemon` loop), so the lock stays live past the heartbeat TTL and after the plugin process exits. Lock, daemon, and adapter are all DI-seamed (injected fs/clock/pid/spawn/push) and unit-tested under `tests/context-vault-indexer/`; end-to-end behavior is pinned by `SCN-context-vault-push` and `SCN-context-vault-indexer-singleton`.

## Settings UI

The "Context Vault tokens" section (Advanced group) lists tokens masked (label, created/last-used dates), creates with a label and reveals the plaintext exactly once in a dismiss-once panel, and revokes behind a confirm dialog. Routes: `GET/POST/DELETE /settings/api/context-vault/tokens` (`src/debug/settings/context-vault-tokens-routes.ts`).

## Security notes

Tokens are 256-bit random, stored only as SHA-256, verified with timing-safe comparison; the push endpoint gives no enumeration oracle. Raw spec text is never persisted past reduction/summarization. Plugin source cannot static-import bare modules, so the plugin entry (`plugins/context-vault/index.ts`) is a dependency-free shim that loads `runtime.ts` via `import.meta.require` (same pattern as `audio-transcribe`).

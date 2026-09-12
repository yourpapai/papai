# Context Vault — external memory for coding sessions (updated per maintainer feedback)

## Goal
Papai acts as external memory for OpenSpec-based coding-agent sessions: a local indexer watches spec directories and pushes parsed structures to Papai; Papai stores a structured index + LLM-generated summaries and exposes exactly 2 chat tools (`list_agent_specs`, `get_agent_spec`).

## Changes vs previous draft (maintainer `/change`)
1. **Token issuance moves to the settings UI** (not a chat command), and a user context may hold **multiple tokens**.
2. **The indexer is packaged as a coding-agent plugin** (loaded by the coding agent, e.g. claude/codex/opencode), but must run as a **single shared process** regardless of how many coding-agent sessions run concurrently.

## Design

### Papai side

**Token management (settings UI, per config-context)**
- New settings-UI section "Context Vault tokens" under the user scope, backed by a new per-context table `context_vault_tokens` (migration): `id`, `config_context_id`, `label`, `token_hash` (SHA-256; plaintext shown once at creation), `created_at`, `last_used_at`, `revoked_at`.
- Routes: `GET/POST/DELETE /settings/api/context-vault/tokens` (list masked, create returns plaintext once, revoke). Reuse the existing settings session auth (`src/debug/server.ts` settings routes) and scope to the config-context id — same pattern as `coding_session_repos` CRUD.
- Multiple tokens per context let the user issue one token per machine/agent and revoke individually. Push endpoints authenticate by hashing the presented bearer token and matching a non-revoked row, resolving to the owning config-context (data isolation per context).

**Push/read API** (mounted in `src/debug/server.ts` behind the public origin, bearer-authed):
- `POST /api/context-vault/push` — body: `{ repo, changeName, files: [{ path, kind: 'proposal'|'design'|'tasks'|'spec'|'other', hash, text? }], deletions: [{ path }] }`. Idempotent: stored per `(context, repo:change-name, path)` with source hash; identical hash = no-op.
- Mechanical files (tasks.md) update index progress only. Semantic files (proposal, design) with a new hash enqueue summary + one-line regeneration **outside any conversation** (a background worker using the configured LLM, e.g. via a scheduled/queue mechanism); raw text is discarded after summarization. Full texts are never stored.
- Storage (new migration): `context_vault_specs` — `config_context_id`, `id` (`repo:change-name`), `repo`, `change_name`, `one_line`, `summary`, `outline` (JSON headings), `stage` (`draft|approved|in-progress|done`), `progress_pct`, `mtime`, `source_hash`, plus `context_vault_files` for per-file hash/kind/mtime and `context_vault_indexer_state` for `last_push_at` (freshness meta).

**Chat tools (exactly 2, plugin `context-vault`)** — `plugins/context-vault/` first-party plugin following `docs/architecture/plugins.md` conventions (manifest, `registerTool`, `storageScope: 'group'`, tools named `plugin_context_vault__list_agent_specs` / `__get_agent_spec` mirroring `list_tasks`/`get_task`):
- `list_agent_specs(repo?, status?, changedSince?)` → name, full ID, one-line, stage, progress, mtime + meta `{ lastPushAt }`.
- `get_agent_spec(id)` → summary, outline, freshness meta. Bare-name resolution only when unique across repos; on collision returns a candidate list.

### Indexer — coding-agent plugin, single shared process
- Distributed as a plugin the coding agent loads (per the agent's plugin mechanism — e.g. an opencode/claude plugin hooking session lifecycle), configured with `{ specDirs, apiUrl, token }`.
- **Single-process guarantee:** the plugin does not watch/push in-process. On activation it checks a lock file (PID + heartbeat, e.g. `<stateDir>/context-vault-indexer.lock`); if a live process holds it, the plugin no-ops; otherwise it spawns (detached) or becomes the indexer daemon. Stale lock (dead PID / expired heartbeat) is reclaimed. Thus N concurrent coding agents → exactly 1 indexer process per machine/user.
- The daemon: scans/watches `specDirs` for `*.md`, maintains a persistent `file → content hash` map (survives restarts; lost pushes re-pushed on next scan since hash differs server-side), parses markdown into `{ id: repo:change-name, outline, stage, progress, mtime }`, pushes deltas.
- Stage detection (mechanical, no LLM): proposal only → `draft`; plan/design exists → `approved`; some tasks.md checkboxes ticked → `in-progress` (%); all ticked or moved to `archive/` → `done`.

## Files to touch
- `src/db/migrations/` — new migration: `context_vault_tokens`, `context_vault_specs`, `context_vault_files`, `context_vault_indexer_state`.
- `src/context-vault/` (new) — token store, push/read handlers, summarization worker, stage/progress reducer.
- `src/debug/server.ts` — mount `/api/context-vault/*` push routes + `/settings/api/context-vault/tokens` routes.
- `client/` settings SPA — new "Context Vault tokens" section (create/list/revoke, plaintext shown once).
- `plugins/context-vault/` — first-party plugin exposing the 2 tools.
- Indexer package (new workspace dir, e.g. `context-vault-indexer/`) — coding-agent plugin + daemon with lock-file singleton.
- `docs/architecture/` — document the feature.

## Verification
- Unit tests: hash-delta logic, stage detection matrix, token hash match/revoke, bare-name collision handling, lock-file singleton (stale lock reclaim, concurrent contenders).
- Story tests (`bun test:stories` tier): push → index updated → tools return freshness meta; revoke token → push rejected; two plugin activations → one daemon.
- `bun check:full` (lint, typecheck, knip, format).

## Explicitly out of scope (unchanged)
`annotate_spec` (deep-links to memo system later), vault search, prefix filter, brainstorming file support, git branches. Accepted limitations: no summary re-generation without re-push; stale summaries while indexer offline.

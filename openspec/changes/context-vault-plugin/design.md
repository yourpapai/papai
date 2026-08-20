# Design: Context Vault — external memory for coding sessions

## Context

See proposal.md for motivation and the maintainer-mandated changes (token issuance in the settings UI, indexer as a coding-agent plugin with a single-process guarantee). Current state that shapes the approach:

- Settings API routes follow the `coding-repos-routes.ts` pattern: `authenticate` → `requireCsrf` → `resolveContextScope(principal, 'read'|'write')` → store call, all inside the session-cookie trust domain (`/settings/api/*`, never `DEBUG_TOKEN`).
- `routeRequest` in `src/debug/server.ts` has a public capability-token lane (`routePublicCapabilityPaths`, used by the transcript viewer) that runs before the auth gate — the established place for bearer-credential routes.
- Plugins get no DB handle; first-party plugins that need core-owned data go through a narrow facade built in `src/plugins/tool-runtime.ts`, gated by a manifest permission (precedent: `coding.secrets` → `coding-secrets-facade.ts`).
- Migrations are forward-only, numbered (`075` is latest), each with a drizzle schema twin under `src/db/` and a companion test under `tests/db/migrations/`.
- Background, outside-conversation LLM calls already exist as a DI-seamed pattern (`src/long-term-memory/extractor.ts`, `src/memory.ts`): a `generateText` seam over the AI SDK, model resolved from the context's central-or-BYOK creds.
- The Write/Edit TDD hook gates implementation files under `src/` and `client/` only; `plugins/` and the new indexer workspace are outside the pipeline.

## Goals / Non-Goals

**Goals:**

- Core-owned, config-context-keyed storage and bearer-authed push surface; the plugin is a thin read facade over that storage.
- Hash-based idempotency so indexer restarts and re-pushes are safe.
- No new runtime dependencies: hashing via `node:crypto`/`Bun.CryptoHasher`, file scanning via `node:fs`, HTTP via `fetch` — the existing stack covers every need, so nothing else is justified.
- One indexer process per machine regardless of coding-agent session count.

**Non-Goals:**

- Coding-agent adapters beyond one reference adapter (opencode); claude / codex adapters are follow-ups that add no new spec behavior.
- Vault search, annotations, prefix filters, brainstorming files, git-branch awareness (unchanged from proposal).
- A general-purpose plugin-arbitrary-SQL or plugin-DB permission — the facade exposes exactly the two read shapes the tools need.
- Summary re-generation without a re-push (accepted limitation, proposal).

## Decisions

### 1. Core owns storage and push; the plugin is read-only facade

`src/context-vault/` (new) holds the token store, push handler, spec store, stage/progress reducer, and summarization queue. The `plugins/context-vault/` plugin registers exactly the two tools and reads through a new `contextVault.read` facade built in `tool-runtime.ts`, mirroring `buildCodingReposFacade`. **Why over plugin_kv or HTTP self-call:** `plugin_kv` is plugin-written state; this data is written by the core push route, and plugins have no DB access. Routing tool reads through an HTTP self-call would require planting a bearer token in plugin config and looping through public auth for purely local data — brittle and needless. The facade keeps the data flow one-directional: indexer → core tables → tools.

### 2. Tokens: SHA-256 hash at rest, not the encrypted secret store

`context_vault_tokens` stores `token_hash` (SHA-256), label, timestamps, `revoked_at`, keyed by `config_context_id`. Plaintext is generated (`crypto.randomBytes(32).hex`), shown once in the settings UI, and never stored or logged. **Why over the BYOK/coding-credentials encrypted store:** those stores encrypt because papai must replay the plaintext to a third party. A vault token is papai-issued and papai-verified — the server never needs the plaintext back, so a hash is strictly stronger than reversible encryption and there is no key-management surface. Verification hashes the presented bearer and compares with a timing-safe compare; `last_used_at` is updated best-effort on successful auth. Settings CRUD (`GET/POST/DELETE /settings/api/context-vault/tokens`) reuses the `coding-repos-routes.ts` pattern verbatim: session auth, CSRF, context-scope resolution, list masked.

### 3. Push route in the public capability lane, not behind `DEBUG_TOKEN`

`POST /api/context-vault/push` is registered alongside `routePublicCapabilityPaths` in `src/debug/server.ts`, before the auth gate, authenticated solely by the vault bearer token. **Why:** `DEBUG_TOKEN` is an operator-wide credential; scoping pushes per config-context requires the vault token to be the auth. The capability-route lane is the existing precedent for exactly this shape (transcript viewer). Body validated with a strict Zod schema (`repo`, `changeName`, `files[]` with `path/kind/hash/text?`, `deletions[]`); oversized bodies rejected. The route works whether or not `debugEnabled` is set, since it sits before the debug-only path check.

### 4. Server derives outline/stage/progress mechanically; LLM only summarizes

On push, for each changed file the server extracts the markdown heading outline and — from the file-kind set plus `tasks.md` checkbox counts — recomputes stage (`draft|approved|in-progress|done`, including the `archive/` path-prefix rule) and `progress_pct`, all before the raw text is discarded. Only `one_line` + `summary` come from the LLM. **Why over indexer-side derivation:** stage semantics are the contract the tools serve; computing them server-side keeps them versioned with papai instead of drifting across N indexer builds in the wild. The indexer stays a dumb watcher (hash, diff, push), which also makes the single-process guarantee the only interesting thing it does.

### 5. Summarization: in-process debounced queue, DI-seamed `generateText`

A semantic file arriving with a new hash enqueues `(config_context_id, change_id)` into an in-process debounce queue (short window collapses multi-file pushes of the same change into one LLM call). The worker resolves the context's LLM creds (central or BYOK, same resolution as other background calls), builds a model, and calls the DI-seamed `generateText` pattern from `long-term-memory/extractor.ts`. Failure keeps the previous summary and logs a warning without token or file-content material. **Why over a plugin scheduled job:** summarization must run when a push arrives regardless of whether any chat context has the plugin enabled, and push-side work is core work. **Trade-off accepted:** summaries are lost on restart mid-queue; the next differing push re-enqueues (raw text is not retained, so an un-summarized change serves outline + freshness meta until then).

### 6. Schema: migration `076_context_vault`, four tables, no backfill

- `context_vault_tokens(config_context_id, token_id, label, token_hash, created_at, last_used_at, revoked_at)` — PK `(config_context_id, token_id)`, index on `token_hash` for auth lookup.
- `context_vault_specs(config_context_id, id, repo, change_name, one_line, summary, outline, stage, progress_pct, mtime, source_hash)` — PK `(config_context_id, id)` where `id = repo:change-name`.
- `context_vault_files(config_context_id, spec_id, path, kind, hash, mtime)` — PK `(config_context_id, spec_id, path)`; this is the idempotency ledger.
- `context_vault_indexer_state(config_context_id, last_push_at)` — one row per context; the freshness meta the tools return.

All new state is keyed by **config-context id** (group-shared durable assets, per the scope model); nothing is thread-scoped, user-scoped, or platform-instance-scoped. Tokens resolve pushes to a config-context; tools resolve reads through the group config-context of the invoking context. Push upserts compare `hash` per file: equal → no-op; changed → update + maybe enqueue summary; `deletions[]` delete rows and drop empty spec shells. Forward-only migration with a drizzle twin (`src/db/context-vault-schema.ts`) and companion migration test; rollback is code-revert (tables inert when the feature ships dark).

### 7. Tool surface and gating

Manifest `contributes.tools: ["list_agent_specs", "get_agent_spec"]`, `storageScope: 'group'`, permission `contextVault.read`; wire names `plugin_context_vault__list_agent_specs` / `__get_agent_spec`. Both are read-only and flow through the standard `tool_prefs` allow/ask/deny resolution with the existing confirmation flow for `ask`; they appear per context in the settings Tools section like any plugin tool. They carry no task-provider capability requirement, so a context with a **null task instance** still gets them, and they are eligible for the guest-mode read-only toolset when a group includes them. `get_agent_spec` resolves a bare name only when unique across repos within the config-context, else returns the candidate full ids. Tool executions receive the raw thread-scoped storage-context id as usual; the facade maps it to the group config-context for reads, so sibling threads share one vault.

### 8. Indexer: agent-agnostic daemon + thin adapter, lock-file singleton

New workspace dir `context-vault-indexer/`:

- `daemon.ts` — periodic scan (not `fs.watch`: network filesystems and Docker bind mounts deliver events unreliably, and the persisted hash map makes full scans cheap) of configured `specDirs` for `*.md`, persistent `file → hash` map under a state dir, delta push via `fetch` with the bearer token, exponential backoff on push failure.
- Lock file `<stateDir>/context-vault-indexer.lock` holding `{ pid, heartbeatAt }`; the daemon refreshes the heartbeat every few seconds. Activation: live PID + fresh heartbeat → no-op; dead PID or heartbeat older than the TTL → reclaim (delete + re-create with `wx`) and spawn the daemon detached. Heartbeat TTL is the primary liveness signal, PID reuse the secondary one.
- `adapters/opencode.ts` — the reference coding-agent plugin: on session start it performs the lock check and spawns if needed; it never watches or pushes in-process. Other agents get identical-thin adapters later.

**Why a separate process at all:** coding-agent plugin lifecycles are per-session; embedding the watcher would fork N watchers for N sessions and race on push. The lock-file singleton is the cheapest cross-agent, cross-CLI mutual exclusion that needs no broker.

### 9. Settings SPA

New "Context Vault tokens" section in `client/settings/` (user scope, context selector like other per-context sections): list (masked), create (label → plaintext shown once in a dismiss-once panel), revoke. No new client dependencies; fetch helpers mirror the coding-repos section.

### 10. TDD order and hook interactions

Implementation files under `src/context-vault/`, `src/db/`, `src/debug/server.ts`, `src/plugins/tool-runtime.ts`, and `client/settings/` are gated by the Write/Edit TDD hook — every write requires a pre-existing failing companion test. Order of work therefore: (1) migration + schema tests, (2) token store + settings-route tests, (3) push route + idempotency tests, (4) reducer + summarization-queue tests, (5) facade + plugin tool tests, (6) settings SPA tests (`tests/client/settings/…`), then the implementation each unlocks. `plugins/context-vault/` and `context-vault-indexer/` are outside the hook pipeline; the same test-first order is applied voluntarily with suites under `tests/` (lock-file singleton and scan/delta logic are pure and unit-testable with injected clock/fs).

## Risks / Trade-offs

- Public push endpoint is a brute-force/oracle target → 256-bit random tokens, SHA-256 + timing-safe compare, no enumeration (uniform 401), body size caps, and per-token `last_used_at` giving users a misuse signal.
- Summaries silently stale while the indexer is offline or the LLM errors → tools always return `lastPushAt` freshness meta; failure keeps the previous summary; accepted per proposal.
- PID reuse could resurrect a stale lock → heartbeat TTL is authoritative; PID liveness is only a fast-path check.
- In-process summary queue loses pending work on restart → next differing push re-enqueues; unsummarized entries still serve outline/stage/progress.
- Polling scan adds latency vs. `fs.watch` → scan interval is small and the hash map makes scans O(files); freshness meta makes staleness visible rather than surprising.
- A second first-party facade permission widens the plugin permission surface → facade exposes exactly two read shapes, no raw rows, no writes.

## Migration Plan

1. Ship migration `076` + routes + worker dark (no plugin approved → no tools surface; push endpoint inert until a token exists).
2. Settings UI ships in the same release; users create tokens per context.
3. Approve/enable the `context-vault` plugin per context in the settings UI (standard hash-keyed approval flow).
4. Rollback: revert code; the four tables are inert and can be dropped manually if desired. No backfill or data transformation exists to unwind.

## Open Questions

- Scan interval and heartbeat TTL concrete values — tunable constants, deferrable to implementation without changing specs or task breakdown.
- Summary prompt shape (length caps, language) — iteration on prompt text does not change externally visible contracts.
- `last_used_at` write cadence (every auth vs. sampled) — a write-volume tuning detail, safe to decide in review.
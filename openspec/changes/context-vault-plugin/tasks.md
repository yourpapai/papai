# Tasks: Context Vault — external memory for coding sessions

Test-first order per design.md §10: every implementation file under `src/` or `client/` is gated by the Write/Edit TDD hook, so the failing companion test lands before the implementation it covers.

## 1. DB migration and schema

- [x] 1.1 Write failing migration test `tests/db/migrations/076_context_vault.test.ts` asserting the four tables, PKs, and the `token_hash` index — `bun test tests/db/migrations/076_context_vault.test.ts`
- [x] 1.2 Create migration `src/db/migrations/076_context_vault.ts` (`context_vault_tokens`, `context_vault_specs`, `context_vault_files`, `context_vault_indexer_state`) and register it in `src/db/index.ts` — `bun test tests/db/migrations/076_context_vault.test.ts`
- [x] 1.3 Add drizzle twin `src/db/context-vault-schema.ts` with a schema-validation test — `bun test tests/db/context-vault-schema.test.ts && bun run typecheck`

## 2. Token store and settings routes

- [x] 2.1 Write failing token-store tests (create returns plaintext once + stores only SHA-256 hash, list masked, revoke, per-config-context isolation, `last_used_at` update) under `tests/context-vault/token-store.test.ts` — `bun test tests/context-vault/token-store.test.ts`
- [x] 2.2 Implement `src/context-vault/token-store.ts` (generation via `crypto.randomBytes`, hash-only persistence, timing-safe verify resolving to config-context) — `bun test tests/context-vault/token-store.test.ts`
- [x] 2.3 Write failing route tests for `GET/POST/DELETE /settings/api/context-vault/tokens` (session auth required, CSRF, context-scope resolution, plaintext-once create response) under `tests/settings/context-vault-tokens-routes.test.ts` — `bun test tests/settings/context-vault-tokens-routes.test.ts`
- [x] 2.4 Implement `src/debug/settings/context-vault-tokens-routes.ts` mirroring `coding-repos-routes.ts` and mount it in `src/debug/settings-api-router.ts` — `bun test tests/settings/context-vault-tokens-routes.test.ts && bun run lint`

## 3. Push API and idempotent storage

- [x] 3.1 Write failing spec-store tests (upsert by `(config_context_id, id, path)` with hash no-op, deletions, empty-shell spec drop, indexer_state `last_push_at`) under `tests/context-vault/spec-store.test.ts` — `bun test tests/context-vault/spec-store.test.ts`
- [x] 3.2 Implement `src/context-vault/spec-store.ts` — `bun test tests/context-vault/spec-store.test.ts`
- [x] 3.3 Write failing push-route tests (bearer auth via token hash, revoked/unknown → uniform 401, strict Zod body validation, body size cap, idempotent re-push, cross-context isolation) under `tests/context-vault/push-route.test.ts` — `bun test tests/context-vault/push-route.test.ts`
- [x] 3.4 Implement `src/context-vault/push-route.ts` and mount `POST /api/context-vault/push` in the public capability lane of `src/debug/server.ts` before the auth gate — `bun test tests/context-vault/push-route.test.ts tests/debug && bun run typecheck`

## 4. Stage/progress reducer and summarization worker

- [x] 4.1 Write failing reducer tests (outline extraction, stage matrix draft/approved/in-progress/done incl. `archive/` prefix, progress from checkbox counts) under `tests/context-vault/reducer.test.ts` — `bun test tests/context-vault/reducer.test.ts`
- [x] 4.2 Implement `src/context-vault/reducer.ts` and wire it into the push path before raw text is discarded — `bun test tests/context-vault/reducer.test.ts tests/context-vault/push-route.test.ts`
- [x] 4.3 Write failing summarization-queue tests (semantic new-hash enqueue, mechanical-only no enqueue, debounce collapse, failure keeps previous summary, DI-seamed `generateText` with central/BYOK cred resolution) under `tests/context-vault/summarizer.test.ts` — `bun test tests/context-vault/summarizer.test.ts`
- [x] 4.4 Implement `src/context-vault/summarizer.ts` following the `long-term-memory/extractor.ts` DI pattern; no raw text persisted after summarization — `bun test tests/context-vault/summarizer.test.ts && bun run lint`

## 5. Plugin facade and chat tools

- [x] 5.1 Write failing facade tests (`contextVault.read` permission gate, storage-context → config-context mapping, list/get read shapes, bare-name uniqueness + collision candidate list) under `tests/plugins/context-vault-facade.test.ts` — `bun test tests/plugins/context-vault-facade.test.ts`
- [x] 5.2 Implement the facade in `src/plugins/tool-runtime.ts` (mirroring `buildCodingReposFacade`) and register the `contextVault.read` permission in `src/plugins/types.ts` — `bun test tests/plugins/context-vault-facade.test.ts && bun run typecheck`
- [x] 5.3 Write failing tool tests (`list_agent_specs` filters + freshness meta, `get_agent_spec` summary/outline/meta, null task instance OK, tool_prefs allow/ask/deny incl. `ask` confirmation, guest read-only eligibility) under `tests/plugins/context-vault-tools.test.ts` — `bun test tests/plugins/context-vault-tools.test.ts`
- [x] 5.4 Create `plugins/context-vault/` (`plugin.json` with the two contributed tools + `storageScope: 'group'`, `index.ts` registering both tools) — `bun test tests/plugins/context-vault-tools.test.ts && bun run typecheck`

## 6. Settings SPA

- [x] 6.1 Write failing client tests for the "Context Vault tokens" section (list masked, create shows plaintext once, revoke) under `tests/client/settings/` — `bun test:client`
- [x] 6.2 Implement the section in `client/settings/` reusing the coding-repos fetch/panel patterns — `bun test:client && bun build:client`

## 7. Indexer package

- [x] 7.1 Write failing lock-file singleton tests (live lock no-op, dead-PID/expired-heartbeat reclaim, concurrent contenders, injected clock/fs) under `tests/context-vault-indexer/lock.test.ts` — `bun test tests/context-vault-indexer/lock.test.ts`
- [x] 7.2 Implement `context-vault-indexer/lock.ts` — `bun test tests/context-vault-indexer/lock.test.ts`
- [x] 7.3 Write failing daemon tests (scan detects changed/deleted `*.md`, persisted hash map survives restart, delta push payload shape, backoff on push failure) under `tests/context-vault-indexer/daemon.test.ts` — `bun test tests/context-vault-indexer/daemon.test.ts`
- [ ] 7.4 Implement `context-vault-indexer/daemon.ts` (periodic scan, hash-map persistence, `fetch` push with bearer token) — `bun test tests/context-vault-indexer/daemon.test.ts`
- [ ] 7.5 Implement `context-vault-indexer/adapters/opencode.ts` (activation performs lock check, spawns detached daemon, never watches in-process) with an adapter test — `bun test tests/context-vault-indexer && bun run typecheck`

## 8. Story-tier integration

- [ ] 8.1 Add story: push → index updated → tools return freshness meta; revoke token → push rejected — `bun test:stories`
- [ ] 8.2 Add story: two plugin activations → exactly one daemon (lock singleton through the adapter seam) — `bun test:stories`

## 9. Final verification and docs

- [ ] 9.1 Update `docs/architecture/plugins.md` (new facade permission) and add the feature page under `docs/architecture/`; cross-link from `CLAUDE.md` doc index if warranted — `bun run lint`
- [ ] 9.2 Run full gate: `bun run test`, `bun run typecheck`, `bun run lint`, `bun check:full` — `bun check:full`
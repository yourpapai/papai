# Tasks: Context Vault indexer daemon entry

Test-first order throughout. Note that the Write/Edit TDD hook does **not** gate
`context-vault-indexer/` (it covers `src/` and `client/` only, per design.md), so the
failing-test-first step is held manually here — write the test, watch it fail, then
implement.

## 1. Config file and token

- [ ] 1.1 Write failing `tests/context-vault-indexer/config.test.ts`: valid file parses; absent / unparseable / schema-invalid file each produce a distinct error; `repos` defaults to empty; rewrite round-trips and never contains a token key — `bun test tests/context-vault-indexer/config.test.ts`
- [ ] 1.2 Implement `context-vault-indexer/config.ts` (Zod schema for `pushUrl`/`intervalMs`/`repos`, read, atomic rewrite via temp file + rename) — `bun test tests/context-vault-indexer/config.test.ts`
- [ ] 1.3 Extend the same test with token resolution: token comes only from `CONTEXT_VAULT_TOKEN`, a token key present in the file is ignored and never re-serialized, missing/empty token yields the exit-worthy error — `bun test tests/context-vault-indexer/config.test.ts`

## 2. Repository identity and worktrees

- [ ] 2.1 Write failing `tests/context-vault-indexer/repo-identity.test.ts` over a fixture tree: `.git` directory resolves to its parent; `.git` file with `gitdir: …/.git/worktrees/<name>` resolves to the main repo root; two worktrees of one repo produce one identity; no `.git` falls back to the spec dir; the upward walk is bounded — `bun test tests/context-vault-indexer/repo-identity.test.ts`
- [ ] 2.2 Implement `context-vault-indexer/repo-identity.ts` with an injected fs seam (no `git` binary, no PATH dependency) — `bun test tests/context-vault-indexer/repo-identity.test.ts`

## 3. IPC channel

- [ ] 3.1 Confirm the unix-socket API assumption in design.md §Open risks against the installed Bun (`Bun.listen({ unix })` / `Bun.connect({ unix })`); if it does not hold, switch the module internals to `node:net` and note it in design.md — `bun --version && bun run typecheck`
- [ ] 3.2 Write failing `tests/context-vault-indexer/ipc.test.ts`: register a new repo → `registered`; identical re-register → `unchanged` with no duplicate and no scan-state reset; different worktree of a known repo → `updated` with the spec dir re-pointed; nonexistent `specDir` → error, repo set unchanged; unknown op, invalid body, and over-cap body each error while the server keeps serving; `status` returns the repo set and last scan time — `bun test tests/context-vault-indexer/ipc.test.ts`
- [ ] 3.3 Implement `context-vault-indexer/ipc.ts` (newline-delimited JSON server + client, Zod validation, 64 KiB cap, socket `chmod 0600`, stale-socket unlink guarded by lock ownership) — `bun test tests/context-vault-indexer/ipc.test.ts`
- [ ] 3.4 Add a registration-persistence test: a registration is written to the config file and reloaded on the next start without a new registration — `bun test tests/context-vault-indexer/ipc.test.ts tests/context-vault-indexer/config.test.ts`

## 4. Multi-repo loop

- [ ] 4.1 Update `tests/context-vault-indexer/daemon.test.ts` for the repo-provider form of `runDaemon`: each tick snapshots the provider and scans every repo with its own `DaemonFs`; a repo added between ticks is picked up on the next tick, not mid-tick; heartbeat cadence, lost-lock exit, and scan-failure isolation all still hold with N repos — `bun test tests/context-vault-indexer/daemon.test.ts`
- [ ] 4.2 Change `runDaemon` to `(getRepos, deps, options)` with `RepoRuntime = { config, fs }`, leaving `scanOnce` untouched — `bun test tests/context-vault-indexer/daemon.test.ts`

## 5. Adapter registration

- [ ] 5.1 Update `tests/context-vault-indexer/opencode-adapter.test.ts`: lock free → spawn, handoff, then register; lock held → register only, no spawn; connect retried on a bounded schedule then warns; a failed registration never throws out of activation — `bun test tests/context-vault-indexer/opencode-adapter.test.ts`
- [ ] 5.2 Implement the adapter change with the widened return type carrying the registration outcome — `bun test tests/context-vault-indexer/opencode-adapter.test.ts`

## 6. Entrypoint

- [ ] 6.1 Write failing `tests/context-vault-indexer/entry.test.ts` against an injected-seam factory (not a spawned process): missing token → non-zero exit, nothing pushed; malformed config → non-zero exit naming the file; valid config → lock acquired, socket bound, loop started over every configured repo; `SIGTERM` → loop aborted, socket closed and unlinked, lock released only when the record still names our pid — `bun test tests/context-vault-indexer/entry.test.ts`
- [ ] 6.2 Implement `context-vault-indexer/entry.ts`: the thin process shell wiring real `node:fs`, `fetch`, `process.env`, argv `stateDir`, and signal handlers into the seams above, plus per-repo `DaemonFs` bound to `state-<hash>.json` and `stateDir` created `0700` — `bun test tests/context-vault-indexer/entry.test.ts`
- [ ] 6.3 Add `"context-vault-indexer:start": "bun run context-vault-indexer/entry.ts"` to `package.json` scripts and verify a manual start against a scratch state dir — `bun run context-vault-indexer:start <scratch-dir>`

## 7. Story coverage

- [ ] 7.1 Extend `tests/stories/integrations/plugins/context-vault-indexer.story.test.ts` (`SCN-context-vault-indexer-singleton`) so a second activation for a different repo registers with the running daemon instead of no-oping, and two worktrees of one repo yield one entry — `bun run test:stories`

## 8. Documentation

- [ ] 8.1 Write `plugins/context-vault/README.md` following the existing plugin-README shape (`plugins/audio-transcribe/README.md`): what the plugin does; contributions table for both tools; `contextVault.read` permission and `tool_prefs` gating; approve + enable in the settings UI, stating that **approval activates in-process** and that only discovery of a newly added plugin directory needs a restart; mint/revoke a token (plaintext shown once); indexer setup — config file, `CONTEXT_VAULT_TOKEN`, adapter wiring, start command, multi-repo and worktree behavior; verification via `status` IPC, `meta.lastPushAt` in tool output, and the token's last-used time in settings; no real token value in any example — `bun run format:check`
- [ ] 8.2 Update `docs/architecture/context-vault.md`: replace the "library-only: it ships no runnable daemon entrypoint of its own" claim, and extend the Indexer singleton section with the config/token split, IPC registration, multi-repo scanning, and worktree collapsing — `bun run format:check`

## 9. Full verification

- [ ] 9.1 `bun run test` — full server-side suite
- [ ] 9.2 `bun run typecheck && bun run lint && bun run format:check && bun run knip && bun run duplicates`
- [ ] 9.3 `bun security` — the change adds a local socket surface, a config-file reader, and a credential read from the environment
- [ ] 9.4 Confirm `context-vault-indexer/` is still outside knip's `project` globs so no `knip.config.ts` entry is needed; if knip now flags the new files, add the entry declaration with a justification comment rather than an ignore — `bun run knip`

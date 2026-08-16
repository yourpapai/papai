# Context Vault indexer: runnable daemon entry, IPC repo registration, plugin README

## Why

`activateOpencodeAdapter` spawns `bun run <daemonEntry> <stateDir>`, but `daemonEntry`
is consumer-supplied and **no such entry exists in this repo** — nothing calls
`runDaemon`. The papai side is complete and tested (push route, reducer, summarizer,
token store, both tools) yet unreachable from a coding agent: there is no process to
spawn. Filling a vault today means a hand-rolled `curl`.

`plugins/context-vault/` is also the only first-party plugin without a README. Setup
lives solely in `docs/architecture/context-vault.md`, which documents internals rather
than the operator path.

## What changes

1. **Runnable entry** `context-vault-indexer/entry.ts` wiring concrete `node:fs` and
   `fetch` into the daemon loop. Config comes from `<stateDir>/config.json`
   (Zod-validated: `pushUrl`, `intervalMs`, `repos`); the vault token comes from
   `CONTEXT_VAULT_TOKEN` and is never written to disk.
2. **IPC repo registration** over a unix socket at
   `<stateDir>/context-vault-indexer.sock`, so a coding-session activation registers
   its repo with the already-running daemon instead of no-oping. One daemon, N repos.
3. **Worktree collapsing** — registration resolves a worktree's spec dir to its main
   repo, so N worktrees of one project stay one vault entry.
4. **`plugins/context-vault/README.md`** — approve/enable, mint a token, wire the
   indexer beside a coding agent, start it, verify it.

## Capabilities and what breaks without each

- **Runnable entrypoint** — without it the spawn path targets a nonexistent file and
  the indexer never runs. `SCN-context-vault-indexer-singleton` pins the lock
  discipline, not that anything spawnable exists.
- **IPC registration** — without it a second coding session finds the lock held,
  no-ops per the current adapter, and its repo is **silently never indexed**. A
  config file alone cannot reach an already-running daemon.
- **Worktree collapsing** — without it three worktrees register as three repos, so
  `list_agent_specs` shows duplicates of one project.
- **README** — without it the operator sequence exists nowhere.

## Scope model impact

No papai-side change: no migration, no DB table, no route, no tool, no manifest edit.
Work lands in `context-vault-indexer/`, one plugin README, and doc updates. Vault rows
stay keyed by **config-context id**, resolved server-side from the bearer token — the
daemon never sees a context id. Group-shared reads through `contextVault.read` and the
thread-to-group facade mapping are untouched. No platform instance is involved, and
the vault still requires no task instance.

## Non-goals

- Changing the push wire format, `applyPush`, the reducer, the summarizer, or either tool.
- Windows named-pipe IPC — unix sockets only; filesystem permissions are the boundary.
- Supervision: no systemd/launchd unit, no auto-restart, no crash reporting.
- Authenticating IPC callers beyond stateDir/socket permissions — **declined**: a
  local caller able to forge a registration could equally read the token from the
  daemon's own environment.
- Watching non-OpenSpec directories or arbitrary globs.
- Batching several repos into one push request; pushes stay per change.

## Affected specs and docs

Extends capability **`context-vault-plugin`** rather than declaring a new one — the
indexer singleton requirement it modifies already lives there. Updates
`docs/architecture/context-vault.md` (its "library-only: it ships no runnable daemon
entrypoint" sentence becomes false) and adds `plugins/context-vault/README.md`.

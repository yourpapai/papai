# Design: Context Vault indexer daemon entry

## Context

Current state in `context-vault-indexer/` (all DI-seamed, all unit-tested):

- `lock.ts` — `acquireIndexerLock` / `handoffIndexerLock` / `refreshIndexerHeartbeat`.
  `refreshIndexerHeartbeat` returns `false` when the record's pid is not ours, which
  `runDaemon` treats as "superseded → exit".
- `daemon.ts` — `scanOnce(config, deps)` (per-repo delta scan and push with backoff)
  and `runDaemon(config, deps, options)` (tick loop owning the heartbeat).
  `DaemonConfig` is `{ repo, specDir, pushUrl, token }`; `DaemonFs` closes over a
  single state file via `readState()` / `writeState()`.
- `adapters/opencode.ts` — `activateOpencodeAdapter` acquires the lock, spawns
  `['bun', 'run', daemonEntry, stateDir]` detached, hands the lock to the child pid,
  and returns `'spawned' | 'already-running'`.

`daemonEntry` has no producer anywhere in the repo, and `already-running` is a dead
end: the second session's repo is never seen. Those two gaps are what this change
closes.

## Decisions

### 1. Config file for settings, environment for the token

`<stateDir>/config.json`, Zod-validated:

```jsonc
{
  "pushUrl": "https://papai.example/api/context-vault/push",
  "intervalMs": 30000,
  "repos": [{ "repo": "papai", "specDir": "/home/u/papai/openspec/changes" }],
}
```

The token is read from `CONTEXT_VAULT_TOKEN` only. Rationale: the daemon **rewrites**
this file on every registration, so a token stored in it would be re-serialized on a
schedule the operator does not control, and would land in any backup or dotfile sync
covering the state directory. Keeping it in the environment also matches how every
other credential in this repo is supplied at process start.

Rejected: env-only config. The adapter spawns detached with `stdio: 'ignore'`, so the
daemon inherits whatever env the coding-agent process happened to carry; a file makes
a manually started daemon and an adapter-spawned one behave identically, and gives the
registration a place to persist.

Both failure modes exit non-zero rather than degrading: no token means every push
would 401 in a silent retry loop, and a malformed config under defaults would push to
the wrong URL or scan nothing while looking healthy.

### 2. IPC over a unix domain socket

`<stateDir>/context-vault-indexer.sock`, newline-delimited JSON, `Bun.listen({ unix })`
server and `Bun.connect({ unix })` client. Two operations:

| Request                                                  | Response                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `{"op":"register","repo":"papai","specDir":"/abs/path"}` | `{"ok":true,"repo":"papai","action":"registered"\|"updated"\|"unchanged"}` |
| `{"op":"status"}`                                        | `{"ok":true,"repos":[…],"lastScanAt":…}`                                   |

Zod-validated, 64 KiB cap, unknown op → `{"ok":false,"error":…}` with the repo set
untouched — the same discipline `push-route.ts` applies to its body, for the same
reason (an unauthenticated-by-construction endpoint).

**No new dependency.** Bun's built-in unix-socket support covers this; nothing in the
stack (AI SDK, Grammy, discord.js, Zod, drizzle) is relevant to a local IPC channel,
and adding an RPC library for two message types would be more surface than the feature.

**Trust boundary is the filesystem.** The socket is `chmod 0600` and `stateDir` is
created `0700`, so the bind→chmod window is not reachable by another user. This is
sufficient because a local process able to forge a registration could equally read
`CONTEXT_VAULT_TOKEN` from the daemon's own environment — an authentication layer here
would protect nothing that is not already exposed. Registration still validates that
`specDir` exists, so a typo fails loudly instead of registering a directory that will
never yield files.

**Stale socket** files are unlinked before binding, but only **after** the singleton
lock is held — the lock is what proves no live daemon owns that path.

### 3. Repository identity and worktrees

Resolution walks up from `specDir` (bounded, stops at the filesystem root) to the
nearest `.git`:

- `.git` is a **directory** → that path's parent is the repo root.
- `.git` is a **file** → it reads `gitdir: <path>/.git/worktrees/<name>`; the main
  repo's git dir is the prefix before `/worktrees/`, and its parent is the repo root.
- Neither → the walk failed; fall back to `specDir` itself as the identity, so an
  OpenSpec directory outside a git repo still works.

No shelling out to `git`: the daemon is spawned detached with `stdio: 'ignore'` and
must not depend on a resolvable `git` binary or inherited PATH.

The **identity** is that canonical root path; the **pushed name** stays the caller's
`repo` field (that is what appears in chat), defaulting to the root's basename.

Re-registering a different worktree of a known repository **re-points** its active
`specDir` (last-writer-wins) rather than adding an entry. Rejected alternative:
first-registration-wins, which silently stops indexing the worktree the developer is
actually working in — the worse failure, because it is invisible. The accepted cost is
that alternating between two worktrees re-pushes the differing changes on each switch;
pushes are idempotent and per-change, so this is churn, not corruption.

### 4. One loop, not two

`runDaemon` already owns tick scheduling, heartbeat cadence, and lost-lock exit.
Rather than write a second loop in the entry, generalize it to a repo provider:

```ts
type RepoRuntime = { config: DaemonConfig; fs: DaemonFs }
runDaemon(getRepos: () => readonly RepoRuntime[], deps: Omit<DaemonDeps, 'fs'>, options)
```

Each tick snapshots `getRepos()` and calls the existing `scanOnce(repo.config, {…deps,
fs: repo.fs})` per repo, sequentially. `scanOnce` is untouched. Sequential rather than
concurrent: the repo count is the number of projects a developer has open, pushes are
already retried with backoff inside `scanOnce`, and `p-limit` is not a dependency of
this standalone package.

Snapshotting at tick start means a registration arriving mid-tick applies to the next
one, which is what the spec states.

### 5. Adapter gains registration

`activateOpencodeAdapter` becomes: lock free → spawn → handoff → register; lock held →
register only. The connect is retried on a bounded schedule (the freshly spawned daemon
needs a moment to bind), then gives up with a warning. A failed registration must never
throw into the coding-agent session — the session is the user's actual work; losing
indexing is a degradation, not a reason to break activation.

Return type widens to carry the registration outcome so the caller can log which of the
two paths ran.

### 6. Shutdown

`SIGINT`/`SIGTERM` abort the loop signal, close the socket, unlink the socket file, and
remove the lock file if the record still names our pid. Releasing the lock on a clean
exit means the next activation spawns immediately instead of waiting out the heartbeat
TTL.

## Scope model impact

Nothing in this change touches papai's scope model. The daemon holds no papai id: vault
rows are keyed by **config-context id**, which `verifyToken` resolves server-side from
the bearer token, so the indexer cannot address a context other than its token's. New
persisted state is keyed by **repository identity** (a local filesystem path hash), not
by any storage-context, config-context, platform-instance, or user id.

New files on disk, all under the caller-chosen `stateDir`: `config.json`,
`context-vault-indexer.sock`, and one `state-<hash>.json` per registered repository.
Per-repo state files are what let a re-pointed worktree diff against the same ledger.
There is no installed base — no entrypoint has ever run — so no state migration is
needed.

## Gating, storage, and DB

- **No tool surface changes.** `list_agent_specs` and `get_agent_spec` keep their
  capability ids, `contextVault.read` gating, `read` risk class, and `tool_prefs`
  allow/ask/deny behavior. Nothing here alters what a guest sees.
- **No DB change**: no migration, no table, no backfill. Migration `076_context_vault`
  and `src/db/context-vault-schema.ts` are untouched.
- **No new dependency** in either the root package or the indexer package.

## New modules

`context-vault-indexer/` gains `entry.ts` (process wiring), `config.ts` (schema, read,
atomic rewrite), `ipc.ts` (server + client), and `repo-identity.ts` (worktree
resolution). No existing module covers these: `daemon.ts` is the scan/push loop,
`lock.ts` is the singleton, and the adapter is the coding-agent shim. Keeping them
separate is also what keeps `entry.ts` — the one file that touches real `node:fs`,
`fetch`, `process.env`, and signals — thin enough to stay under the `max-lines` limits
while every decision underneath it stays unit-testable through its injected seams.

## Hook and TDD interaction

The Write/Edit TDD hook pipeline gates only paths starting with `src/` or `client/`
(`docs/architecture/commands.md`), so **none** of these files trigger it —
`context-vault-indexer/`, `plugins/context-vault/README.md`, and `docs/` all pass
through. The test-first order in tasks.md is therefore a discipline this change holds
itself to rather than one the hook enforces; the existing suites under
`tests/context-vault-indexer/` are the pattern to follow, and every task names the
command that proves it.

Story-level behavior belongs in the existing `SCN-context-vault-indexer-singleton`
scenario, extended so the second activation registers rather than merely no-oping.

## Open risks

- **Bun unix-socket API surface.** The design assumes `Bun.listen({ unix })` /
  `Bun.connect({ unix })`. Task 3.1 verifies this against the installed Bun before the
  IPC module is written; if it does not hold, `node:net` is the fallback with no design
  consequence beyond the module's internals.
- **Worktree `gitdir` parsing** covers the standard `git worktree add` layout. Exotic
  layouts fall back to path identity, which degrades to today's behavior (one entry per
  directory) rather than failing.

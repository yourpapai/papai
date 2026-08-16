# Context Vault

> Plugin ID: `context-vault` · Version: 1.0.0 · `defaultEnabled: false`

External memory for coding sessions. An indexer running next to a coding agent
pushes OpenSpec change files to papai; papai reduces them to an outline, stage,
and task progress, summarizes the semantic ones with the context's LLM, discards
the raw text, and exposes the result to chat through two read-only tools. Ask
"what's the status of the alpha change?" in Telegram and the bot answers from
your repository's live specs.

Architecture and internals: [`docs/architecture/context-vault.md`](../../docs/architecture/context-vault.md).

## Contributions

| Surface | Name               | Notes                                                                                  |
| ------- | ------------------ | -------------------------------------------------------------------------------------- |
| Tool    | `list_agent_specs` | Lists pushed spec changes; optional `repo`, `status`, `changedSince` filters           |
| Tool    | `get_agent_spec`   | Reads one change by `repo:change-name`, or a bare change name when unique across repos |

Both return `meta.lastPushAt` so the agent can tell a quiet vault from a stale
one. `get_agent_spec` returns the candidate ids instead of a spec when a bare
name is ambiguous across repositories.

## Permissions

`contextVault.read` — the only permission the manifest declares. The facade maps
the raw thread-scoped storage-context id to the group **config-context**, so
sibling threads in a group share one vault. No task instance is required.

## Gating

Both tools are classified `read` risk in `TOOL_METADATA`, so they survive the
guest read-only filter, and both honour the per-context `tool_prefs`
`allow`/`ask`/`deny` setting like any other tool. Set them individually in the
settings Tools section, where they appear grouped under this plugin.

## Setup

### 1. Approve and enable the plugin

Open `/config`, then in the settings UI:

1. **Plugins** (admin area, super admin) → approve `context-vault`. Approval
   activates the plugin **in-process** — the approve route runs the activation
   itself, so the tools are available on your next message with no restart. Only
   discovery of a _newly added_ plugin directory needs a restart, because
   `discoverPlugins` runs once at startup; `context-vault` ships in-tree and is
   already discovered.
2. Enable it for your context.
3. Optionally set the two tools to `ask` or `deny` in **Tools**.

Approval is keyed to the manifest hash, so editing `plugin.json` or the entry
point clears it and it must be approved again.

### 2. Mint a vault token

**Advanced → Context Vault** in the settings UI. Create a token with a label
naming the machine it is for; the plaintext is shown **exactly once** in a
dismiss-once panel — copy it then, because only its SHA-256 hash is stored.
Tokens are scoped to the group config-context, and the list shows each token's
last-used time, which is how you confirm an indexer is actually reaching papai.

Revoke from the same section. A revoked token's next push gets a 401 immediately.

### 3. Configure the indexer

The indexer keeps its settings in a JSON file in its state directory,
`<stateDir>/config.json`:

```jsonc
{
  "pushUrl": "https://papai.example.com/api/context-vault/push",
  "intervalMs": 30000,
  "repos": [{ "repo": "papai", "specDir": "/home/you/papai/openspec/changes" }],
}
```

The **token never goes in this file** — it is read only from the
`CONTEXT_VAULT_TOKEN` environment variable. The daemon rewrites `config.json`
on every registration, so a token stored there would be re-serialized on a
schedule you do not control; a `token` key in the file is ignored and stripped.

A missing token, or a config file that is absent, unparseable, or invalid, exits
non-zero with a diagnostic rather than starting a loop that silently indexes
nothing.

### 4. Start the daemon

Directly:

```bash
CONTEXT_VAULT_TOKEN=… bun run context-vault-indexer:start /path/to/state-dir
```

Or let a coding-agent plugin start it. `activateOpencodeAdapter`
(`context-vault-indexer/adapters/opencode.ts`) is the reference wiring: on
session activation it checks the lock file, spawns
`context-vault-indexer/main.ts` detached when the lock is free, hands the lock
to the daemon's pid, and registers the session's repository either way. The
spawned daemon inherits the coding-agent process's environment, so
`CONTEXT_VAULT_TOKEN` must be set there.

Any number of concurrent coding sessions yield exactly **one** daemon per state
directory: a session that finds the lock held registers its repository with the
running daemon over `<stateDir>/context-vault-indexer.sock` instead of starting
a second one. Registrations persist to `config.json`, so a restart resumes
without re-registering.

Stop it with `SIGINT`/`SIGTERM`: the loop aborts, the socket is closed and
unlinked, and the lock is released — but only while it still names this
daemon's pid, so a superseded daemon never deletes its replacement's lock.

### Multiple repositories and worktrees

One daemon watches many repositories, each with its own scan-state file
(`state-<hash>.json`). Registration resolves a spec directory to the repository
that owns it, so **N git worktrees of one project stay one vault entry** rather
than appearing as N repos in `list_agent_specs`. Registering a different
worktree of a known repository re-points its active spec directory, on the
reasoning that the freshly activated session is the one being worked in. The
cost is that alternating between two worktrees re-pushes the differing changes
on each switch; pushes are idempotent and per-change, so that is churn rather
than corruption.

### 5. Verify

- **Is the daemon up and what is it watching?** Send it a status request over
  its socket — `{"op":"status"}` returns the registered repositories and the
  last scan time.
- **Is papai receiving?** The token's last-used time in the settings section
  advances on every accepted push.
- **Is chat seeing it?** `list_agent_specs` returns `meta.lastPushAt`.

## Behavior notes

- **What is stored** — outline, stage, checkbox progress, a one-line summary and
  a detailed summary. Raw spec text is discarded after reduction and
  summarization; it is never persisted.
- **Stage derivation** is mechanical, no LLM: archived or all boxes ticked →
  `done`; some ticked → `in-progress`; otherwise `approved` when a `plan` or
  `design` file exists, else `draft`.
- **Summarization** covers the semantic kinds (`proposal`, `design`, `plan`,
  `spec`) through a debounced 15 s in-process queue using the context's central
  or BYOK LLM config. A failure keeps the previous summary, and a bot restart
  loses pending work until the next differing push re-enqueues it; outline,
  stage, and progress serve unsummarized specs meanwhile. `tasks` files are
  mechanical and never trigger the summarizer.
- **Idempotent pushes** — the daemon persists a `file → hash` map and pushes
  only differences; an equal-hash push is a server-side no-op, and state
  advances only for pushes that succeeded, so a restart re-pushes exactly the
  unacked delta.

## Security notes

The push endpoint is mounted in the debug server's **public** capability lane,
before the auth gate — the bearer token is the entire credential. Tokens are
256-bit random, stored only as SHA-256, and compared with a timing-safe check;
unknown, revoked, and malformed tokens all get an identical 401, so the endpoint
is not an enumeration oracle. Treat a vault token like a deploy key and keep
papai behind TLS.

Locally, the trust boundary is the filesystem: the state directory is forced to
`0700` (tightened with a warning if it already existed looser) and the socket to
`0600`. There is no authentication on the socket itself, deliberately — a local
process able to forge a registration could equally read `CONTEXT_VAULT_TOKEN`
from the daemon's own environment.

## Enabling

Approve the plugin in the settings UI admin Plugins area (super admin), then
enable it per context. It has no configuration keys of its own; the vault it
reads is filled by an indexer authenticated with a token from the Context Vault
settings section.

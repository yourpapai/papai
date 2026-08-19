<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MCP integration research for the agent pipeline

What it would take to give the `opencode-agent` pipeline MCP servers: which
config surface the pinned SDK exposes, which of its runtime endpoints an
unattended CI job can actually drive, where an `mcp` block could be injected
per candidate option, and what each option would cost in credential exposure.
Issue #301; docs-only deliverable.

The document is built evidence-first, in the order the plan records evidence:
this file starts at §1 with the pinned SDK surface, and the later sections
land as their live experiments run. Every behavioural claim carries its label
— **by inspection** for claims read off a pinned package's own files,
**verified** for claims a live run of the real binary demonstrated — and a
live label supersedes an inspection label wherever both exist.

---

## 1. The pinned SDK surface — recorded, not guessed

Everything in this section is **by inspection** of the two installed pins; no
server was started to write it. Anchors are `file:line` and move with any pin
bump — that is the point of recording them.

### 1.1 The two pins

| What                    | Pin                    | Recorded at                                                  |
| ----------------------- | ---------------------- | ------------------------------------------------------------ |
| Types (this section)    | `@opencode-ai/sdk` 1.18.16 | `bun.lock:388`; declared `^1.18.16` (`opencode-agent/package.json:21`) |
| Server binary (reads the config) | `opencode-ai` 1.18.7 | `.github/workflows/agent-pipeline.yml:416` (`bun add --global opencode-ai@1.18.7`) |

Two things a later bump must know. First, the pins are **different packages at
different versions**: the SDK's generated types only _describe_ the config; the
server binary is what _reads_ it, and the workspace `CLAUDE.md` already records
the precedent that the server's loader honours keys the generated types
under-declare (`AgentConfig` admits fields only through its index signature).
A field absent from §1.2 may still work — and a field present may be ignored;
only a live run against the binary settles it, which is §2's job. Second, the
workspace `CLAUDE.md` names the older pair `sdk@1.18.12` / `opencode-ai@1.18.7`;
the lockfile has since moved the SDK to 1.18.16 while the binary stayed put.
On any bump of either pin, re-verify: the §1.2/§1.3 anchors and field lists
against the new `types.gen.d.ts`, and every §2 **verified** claim against the
new binary.

### 1.2 The `mcp` config block

All anchors in this subsection are
`opencode-agent/node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`,
inside the window `sed -n '1462,1503p'` prints.

| Type              | Lines     | Fields                                                                                                                          |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `McpLocalConfig`  | 1462–1477 | `type: "local"`; `command: Array<string>`; `cwd?`; `environment?: { [key]: string }`; `enabled?`; `timeout?`                     |
| `McpOAuthConfig`  | 1478–1484 | `clientId?`; `clientSecret?`; `scope?`; `callbackPort?`; `redirectUri?`                                                          |
| `McpRemoteConfig` | 1485–1503 | `type: "remote"`; `url: string`; `enabled?`; `headers?: { [key]: string }`; `oauth?: McpOAuthConfig \| false`; `timeout?`         |

Three of those fields carry decisions for an unattended runner, all **by
inspection**:

- `oauth?: McpOAuthConfig | false` (1498–1501) — the doc comment reads "Set to
  false to disable OAuth auto-detection". Every field of `McpOAuthConfig`
  exists to receive a **browser** redirect (`callbackPort`, `redirectUri`) or
  pre-register an OAuth client; none of them authenticates headlessly. `false`
  is the only value in this arm an unattended job can mean.
- `headers?: { [key]: string }` (1495–1497) — static bearer/header auth on a
  remote, the headless alternative to the OAuth arm above.
- `environment?: { [key]: string }` (1472–1474) — extra env for a local
  server's process. The pipeline's `contain()` placeholder discipline
  (`opencode-agent/CLAUDE.md`, "One model endpoint") applies to it unchanged:
  whatever lands here is readable by the spawned server's children.

The container is `Config.mcp` (1583–1587):

```ts
mcp?: {
    [key: string]: McpLocalConfig | McpRemoteConfig | {
        enabled: boolean;
    };
}
```

The third arm is a **name-only disable** — an entry that says nothing but
`enabled: false` — and both full types also carry `enabled?`. Together they are
the `enabled: false` semantics §2 exercises against the binary.

Server-side state comes back as `McpStatus` (1965–1982), a five-way union:
`connected` | `disabled` | `failed` (+ `error: string`) | `needs_auth` (1975) |
`needs_client_registration` (+ `error: string`) (1978). Two consequences **by
inspection**: a failed startup is _observable as data_ — `failed` carries the
error string, so a driver can tell "blocked" from "absent" without a human; and
`needs_auth` has no non-interactive remedy anywhere in this SDK surface (§1.3),
so a config that can reach it is a config an unattended job cannot finish
starting.

### 1.3 Runtime endpoints and their unattended verdict

The SDK's `Mcp` client class is `sdk.gen.d.ts:648–686` (`status`, `add`,
`connect`, `disconnect`); the OAuth family sits on `Auth2` (`sdk.gen.d.ts:604–647`).
HTTP verbs and URL templates are `sdk.gen.js:1246–1403`. Request/response
anchors below are `types.gen.d.ts`.

| Endpoint                          | Verb    | Request → 200 response                        | Anchor        | Unattended?    |
| --------------------------------- | ------- | --------------------------------------------- | ------------- | -------------- |
| `GET /mcp`                        | get     | — → `{ [name]: McpStatus }`                   | 7197–7221     | **usable**     |
| `POST /mcp`                       | post    | `{ name, config }` → `{ [name]: McpStatus }`  | 7222–7249     | **usable**\*   |
| `POST /mcp/{name}/connect`        | post    | — → `boolean`                                 | 7373–7401     | **usable**     |
| `POST /mcp/{name}/disconnect`     | post    | — → `boolean`                                 | 7402–7430     | **usable**     |
| `POST /mcp/{name}/auth`           | post    | — → `{ authorizationUrl, oauthState }`        | 7281–7312     | dead end       |
| `POST /mcp/{name}/auth/callback`  | post    | `{ code }` → `McpStatus`                      | 7313–7343     | dead end       |
| `POST /mcp/{name}/auth/authenticate` | post | — → `McpStatus`                              | 7344–7372     | dead end       |
| `DELETE /mcp/{name}/auth`         | delete  | — → `{ success: true }`                       | 7250–7280     | usable, moot\* |

\* Two caveats, both **by inspection** and both handed to §2 as questions:
`POST /mcp` adds a server to the _running_ instance, and nothing in the surface
claims the addition survives a server restart — for a pipeline that spawns a
fresh server per job, the durable route is config injection (§4), with `POST /mcp`
as a per-boot re-add at best. `DELETE /mcp/{name}/auth` is unexceptional as a
call but only means something once OAuth credentials exist, which the dead-end
rows below say an unattended job never obtains.

The verdict column, justified. `GET /mcp` is a pure read answering the status
map of §1.2 — the poll a CI driver loops on after feeding config.
`connect`/`disconnect` answer `boolean` and need no interaction; a connection
that fails comes back through `McpStatus.failed`, which carries the error
string, so even the failure is data. The OAuth family is the dead end, and it
is structural rather than fixable at the call site: `auth` **hands back an
`authorizationUrl`** — a URL whose whole purpose is to be visited by a human in
a browser; `callback` takes the `code` that visit yields; and `authenticate`
is documented, in the SDK's own method comment (`sdk.gen.d.ts:640`), as
"Start OAuth flow and wait for callback **(opens browser)**". No composition of
the three is headless, and the terminal status they exist to clear
(`needs_auth`, `types.gen.d.ts:1975`) has no other remedy in this surface.

So the unattended route is not "complete OAuth without a browser" — the surface
offers no such thing — but "avoid OAuth entirely": a **local** stdio server
(`McpLocalConfig`, needs no auth) or a **remote** with static `headers` and
`oauth: false`. Those two shapes are exactly what §2's experiments drive, and
§4's per-option injection points must be able to express both.

### 1.4 The CI constraints — compiled with citations, not re-derived

Everything the pipeline already knows about what a credential and a config can
survive on an Actions runner, read off where it is stated. The two findings the
plan names by id sit in `ROADMAP.md` (both marked `[FIXED]` there — the fix
closed the finding, not the property; the properties are what MCP must live
with). All **by inspection** of the cited files; §3 applies each fact per
option, this subsection only records it. Verify command for the pair:
`grep -n 'S3-7\|S3-9' opencode-agent/ROADMAP.md` → lines 857 and 899.

| # | Constraint (as stated)                                        | Where stated                                                                 | Why the plan cares about it for MCP                                                                                                        |
| - | ------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **S3-9** — the model reads the server's environment: `opencode serve` is spawned with the whole serialized config in `OPENCODE_CONFIG_CONTENT`, and every process the model starts with `bash` inherits it; verified against `/proc/<pid>/environ`. Fix = placeholder key + loopback proxy (`provider-proxy.ts`) | `ROADMAP.md:899–939` (heading 899); restated `README.md:1442–1449` (`"one \`echo\` away"`, 1446) | The `mcp` block rides in that same variable. Whatever it carries — a remote's `headers` token, a local's `environment` values — is readable by the model with one `echo`. S3-9 moved the provider key out of the var; the var itself is as readable as ever, so an MCP credential fed through it is the same finding one surface over. |
| 2 | **S3-7** — a credential must sit in none of the three places the model can reach: not `.git/config` (`persist-credentials: false`), not argv (`/proc`, published `GitError`), not the server's environment; git gets it per invocation via `GIT_CONFIG_COUNT`/`_KEY_0`/`_VALUE_0` | `ROADMAP.md:857–897` (heading 857); restated `README.md:1435–1441`; enforced `agent-pipeline.yml:352,376` | A repo-committed config file carrying an MCP token puts a credential in a file the `build` profile can read — the exact class S3-7 closed for git. The per-invocation env-config delivery is the precedent any repo-file-with-interpolation option must meet.            |
| 3 | **Masking** — outbound bodies are scrubbed of pipeline credentials by value at the GitHub adapter, not in renderers; log lines get the same value pass; "GitHub masks registered secrets in an Actions log, but it does not mask an issue comment"; the log is world-readable and not covered by the outbound redaction | `README.md:1428–1433` (adapter redaction + the mask quote), `1449–1452` (log lines), `1151–1160` (world-readable log, progress never carries content) | A token the pipeline never loaded into `pipelineSecrets` is masked nowhere — not in a log (GitHub masks only registered Actions secrets), not in an issue comment (redaction is by the pipeline's own values). An MCP credential that bypasses config loading escapes every scrub. |
| 4 | **Egress** — "there is no container or network boundary around the model, only these capability and credential boundaries" (S3-2's last open direction) | `README.md:1456–1457`; also `2046–2048` ("capability containment is config-level, not process-level") | A remote MCP server is direct egress from the runner, reachable by any tool once permitted; nothing network-level bounds where it can send. The provider proxy is the one egress indirection that exists — the loopback-placeholder pattern is the precedent, and its generalisation is §6's deferred assessment.                          |
| 5 | **Ephemeral home** — the runner and its `$HOME` are per-job: the CLI is reinstalled every job (`bun add --global opencode-ai@1.18.7`, `$HOME/.bun` onto `GITHUB_PATH`), there is no `actions/cache` anywhere in the workflow, OpenCode's durable state lives under `$HOME/.local/share/opencode`, and "the runner is ephemeral" | `agent-pipeline.yml:414–418` (reinstall), no `cache:` in the file, `:623` (`$HOME/.local/share/opencode/log`), `ROADMAP.md:2218` ("The runner is ephemeral") | OpenCode's per-user durable state — global config, auth storage, any OAuth tokens — dies with every job. Nothing MCP-side can be "installed once and reused": config must be re-established per job, which favours injection (config content, per-boot re-add) over any durable side state, and kills OAuth on residency grounds too. |

One reading note on the two `[FIXED]` markers, because it is easy to over-read
them: **S3-9 fixed where the provider key lives, not what the model can read.**
`OPENCODE_CONFIG_CONTENT` is still set on the spawned server and still
inherited by every model-started process — the fix stopped putting a real
credential in it. For MCP the constraint is the *still-true* half: an `mcp`
block — and anything its `headers` / `environment` fields carry — is delivered
through exactly that channel, so the placeholder-and-proxy shape is not a
convention the option list may quietly drop. **S3-7 fixed where the git token
lives**; the three-place rule it verified is general, and the option list in §2
scores every candidate against it rather than against git specifically.


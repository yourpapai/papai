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

---

## 2. Live evidence from the real binary

Everything in this section is **verified** against the real `opencode-ai@1.18.7`
(the workflow's pinned binary, present on this runner) driven through the pinned
SDK's `createOpencodeServer` — the same spawn path as `opencode-connect.ts`, so
the config below reached the binary as `OPENCODE_CONFIG_CONTENT` exactly as a
pipeline job would deliver it. No model credentials: a stub OpenAI SSE endpoint
stands in for the provider (the `live-sdk.integration.ts` pattern), so the one
prompt below cost nothing and leaked nothing. The fixture is the throwaway
stdio server from the plan's step 2.1 — a minimal JSON-RPC responder exposing
`echo` and `env_probe`, placeholder token values only, living in the job's temp
dir. Its trace log records the full JSON-RPC conversation, which is where
several claims below come from. Pid discipline held throughout: every MCP child
was wrapped to record its own pid before `exec`, teardown killed exactly those
pids, and the control plane (`opencode-agent:test:survival`) ran green after
every experiment — no candidate took the server down.

### 2.1 Tool naming is `<server>_<tool>` — and the permission table gates it

Fed config (the `mcp` block, under the pipeline-shaped provider config):

```json
{
  "research": {
    "type": "local",
    "command": ["bash", "-c", "echo $$ > …/live-echo.pid; exec node …/echo-server.mjs"],
    "environment": {
      "MCP_EXAMPLE_TOKEN": "PLACEHOLDER-TOKEN-NOT-A-SECRET",
      "ECHO_SERVER_TRACE": "…/conversation.log"
    }
  }
}
```

**Verified** — the handshake and the naming. OpenCode sent `initialize`
(protocolVersion `2025-11-25`, `clientInfo.name: "opencode"`), then
`notifications/initialized`, then `tools/list`; my server answered both tools;
`GET /mcp` reported `{"research":{"status":"connected"}}` in ~120 ms. With no
agent permission blocks in the config, the **model-visible tool table** (read
straight off the stub provider's request body) was:

```json
["bash","edit","glob","grep","question","read","research_echo",
 "research_env_probe","skill","task","todowrite","webfetch","write"]
```

— `<server>_<tool>` naming, `research_echo` / `research_env_probe`, exactly as
the plan hypothesised. Forced tool call round trip: the stub emitted a
`research_echo` call with `{"value":"naming-proof"}`; the conversation log then
records `tools/call` with `name: "echo"` (unprefixed — the prefix is stripped
before the wire to the server) and my server's answer
`echo: naming-proof` came back to the model as a `role: "tool"` message in the
provider's next request. One artefact worth noting: after the result was
delivered, OpenCode also sent `notifications/cancelled` for the same request id
with an `AbortError` reason — turn-end cleanup racing a completed call, not a
failure; the result had already been consumed. The `environment` field is also
**verified** live: `ECHO_SERVER_TRACE` set in the config reached the child, and
the placeholder token is what the `env_probe` tool reports.

**Verified** — and this is the finding that shapes §4: under the pipeline's own
config (`buildOpencodeConfig`, whose profiles are deny-by-default — `"*": "deny"`
plus named allows) the **same connected server's tools do not reach the model at
all**. The stub's table under the `build` agent was exactly the granted set —
`["bash","edit","glob","grep","read","todowrite","write"]` — with no
`research_*` entries, and a model attempt to call `research_echo` anyway did
not reach the server (no `tools/call` in the trace). So the permission table
filters the prompt-time tool set, and MCP tools are subject to it: deny by
default holds for them too, and the grant key form (the `<server>_*` wildcard)
is load-bearing — pinned in §2.4 below, not assumed from this observation.

### 2.2 Startup failure, `enabled: false`, and the never-hang claim

Fed config — four servers in one block, one boot:

```json
{
  "research":      { "type": "local", "command": ["bash","-c","…; exec node …/echo-server.mjs"] },
  "research_bad":  { "type": "local", "command": ["bash","-c","…; exec node /nonexistent/mcp-server.mjs"] },
  "research_off":  { "type": "local", "command": ["bash","-c","…; exec node …/echo-server.mjs"], "enabled": false },
  "research_hang": { "type": "local", "command": ["bash","-c","…; exec sleep 600"] }
}
```

**Verified** — the server booted in ~1.2 s with all four present, and the final
status map was:

```json
{
  "research":      { "status": "connected" },
  "research_bad":  { "status": "failed", "error": "MCP error -32000: Connection closed" },
  "research_off":  { "status": "disabled" },
  "research_hang": { "status": "failed", "error": "Operation timed out after 30000ms" }
}
```

- **A nonexistent command degrades to data, not to a hang or a crash** —
  `failed` with an error string, tools absent from the listings, boot and every
  other endpoint unaffected.
- **`enabled: false` means `disabled`, and the child is never spawned at all** —
  the pid-recording wrapper never wrote its file, so OpenCode filtered the
  entry before exec, exactly what the name-only-disable arm of `Config.mcp`
  implies (§1.2).
- **A stdio child that never initializes is bounded by OpenCode itself: 30 s**,
  then `failed` with `Operation timed out after 30000ms` — and the stuck child
  was reaped (its recorded pid was already gone at teardown). The pipeline
  needs no timeout of its own to guarantee termination, but a **status poller
  must bound its own calls**: `GET /mcp` **blocked until the slowest client
  settled** — two consecutive polls hit their own 10 s deadline and only the
  third (~33 s after boot) answered, with every entry final. The cheap
  endpoints never blocked: `GET /experimental/tool/ids` answered in ~8 ms
  throughout, and session traffic worked after everything. So: never a hang —
  but a driver that polls status should treat the 30 s ceiling as the
  poll-time floor, or it will read its own timeout as a missing server.
- The built-in listing endpoints stay **MCP-blind**: `/experimental/tool/ids`
  listed the fourteen built-ins and no `research_*` in any scenario, connected
  or not — the tool table an MCP tool joins is the prompt-time one (§2.1), not
  these listings. A pipeline cannot discover MCP tool names from `tool.ids`;
  the naming contract (`<server>_<tool>`) is the only thing it can rely on.

### 2.4 The permission key form that grants `<server>_<tool>` tools

Same method as the existing plan/build permission table
(`ROADMAP.md` S3-2's verification): feed the config to the real binary and
read back the **resolved rules** it reports — here `GET /agent` through the
pinned SDK (`client.app.agents()`, the listing `opencode agent list` prints),
where each agent carries `permission: Array<{permission, pattern, action}>`.
Closed with the §2.2 stub method too, so the claim is not config resolution
but an **observed** model-visible table. Pipeline-shaped configs throughout
(`buildOpencodeConfig` output, deny-by-default profiles, `mcp.research`
connected); the only edits were the grant keys under test:

```json
"agent": {
  "build": { "permission": { "*": "deny", "read": "allow", "edit": "allow",
                             "bash": "allow", "…": "…", "research_*": "allow" } },
  "plan":  { "permission": { "*": "deny", "read": "allow", "…": "…",
                             "research_echo": "allow" } }
}
```

**Verified** — the grant key form is the tool-name pattern, and the practical
shape is the `<server>_*` wildcard:

| Fed key (in the profile's map) | Resolved rule reported          | Model-visible table under that profile            |
| ------------------------------ | ------------------------------- | ------------------------------------------------- |
| `research_*` (on `build`)      | `{permission:"research_*", pattern:"*", action:"allow"}` | `bash edit glob grep read research_echo research_env_probe todowrite write` — **both** tools admitted |
| `research_echo` (on `plan`)    | `{permission:"research_echo", pattern:"*", action:"allow"}` | `glob grep read research_echo todowrite` — **exactly one** tool admitted |
| `research` (bare, on `build`)  | `{permission:"research", pattern:"*", action:"allow"}` — accepted silently | `bash edit glob grep read todowrite write` — **nothing** admitted |

Three readings for §4. The **wildcard spans the server's whole toolset** — one
key, both tools — and stays inside deny-by-default: profiles without the key
(the `plan` row never carried `research_*`) admit nothing, so a server granted
to `build` is invisible to `plan`. The **exact-name form** works and grants
exactly that tool, so per-tool narrowing is available if an option ever needs
it. And the **bare server name is a silent no-op**: the binary accepts it as a
rule and reports it resolved, while the table admits nothing — a typo'd grant
(`research`, no `_*`) fails quietly, which is worth a one-line guard wherever
§4 generates the key.

**Verified** — and the finding that decides where the grant must live: a
`research_*` allow on the **global** `permission` block does **not** reach a
profile that carries its own map. With the grant on the global block only, the
unnamed built-ins that inherit it (`general`, `explore`, `title`, `summary`,
`compaction` — the agents this pipeline never names) reported
`research_*: allow` in their resolved rules, but `build` — whose own map ends
in `"*": "deny"` — resolved to a ruleset that **contains** the global's
`research_*: allow` *and still admitted no research tools* (its table was
`bash edit glob grep read todowrite write`). The resolved list is an ordered
concatenation — built-in base rules, then the global block, then the agent's
own — and the outcome is consistent with the later rule winning: the agent's
trailing `"*": "deny"` cancels the global's earlier allow. The mechanism
(order precedence) is read off the list order; the outcome (rule present,
tools absent) is the observed fact. So for the pipeline's shape the grant
belongs **in each profile's map**, placed with the other allows after the
`"*": "deny"` — exactly how `grant()` in `openai-config.ts` already emits its
maps — and a global-default grant on its own would be a no-op for every agent
the pipeline prompts.

### 2.5 The two dead ends an unattended job cannot use

Both exercised live against the binary — neither needed a browser to reach the
dead end, only to be stuck at it.

**Verified — the `ask`-permission deadlock.** Fed config: the pipeline shape
with `build`'s map carrying `"research_echo": "ask"` alongside its
deny-by-default entries (keys: `*`, `read`, `grep`, `glob`, `list`,
`todowrite`, `edit`, `bash`, `external_directory`, `research_echo`). The stub
provider forced one `research_echo` call. The turn **stalled** — twelve
seconds with no completion — while `GET /permission` reported exactly one
parked request:

```json
{ "id": "per_01b455cff001lu9sBc9TM0a1ZQ",
  "sessionID": "ses_fe4baa68affetEaVfOs5jQj8LX",
  "permission": "research_echo", "patterns": ["*"],
  "always": ["*"],
  "tool": { "messageID": "msg_01b455b49001LUkTW2Cns2Rgm5", "callID": "call25" } }
```

Replying `{"reply": "reject"}` to `POST /permission/{id}/reply` **unblocked
the turn at once** — it completed with parts `step-start, tool, step-finish`.
That is the deadlock in one line: the turn waits on an answer only a human
(or a driver speaking the reply endpoint) can give, and nothing in an
unattended job ever will. `openai-config.ts` already refuses `"ask"` for
exactly this reason ("the job is unattended and a prompt would deadlock it") —
the observation extends the rule from built-in tools to MCP grant keys: an
MCP entry must be `allow` or absent, never `ask`.

**Verified — the OAuth dead end, `needs_auth` included.** Fed config: two
`remote` entries pointing at the same local HTTP endpoint that answers every
request `401` with a `WWW-Authenticate: Bearer …` header — the MCP OAuth
discovery signal. The binary ran the whole discovery ladder against it:
`POST /mcp`, `GET /mcp`, `POST /mcp`, then
`GET /.well-known/oauth-authorization-server`,
`GET /.well-known/openid-configuration`, and `POST /register` (dynamic client
registration) — six requests — and settled both entries on the **first**
status poll:

```json
{ "research_oauth":      { "status": "needs_auth" },
  "research_oauth_off":  { "status": "failed",
                           "error": "SSE error: Non-200 status code (401)" } }
```

So `McpStatusNeedsAuth` is a real, reachable state, reached exactly as §1.3
read it: auto-detection on a 401 remote. And from there the only remedies are
the browser family — **by inspection** of the pinned surface (§1.3): `POST
/mcp/{name}/auth` hands back an `authorizationUrl` whose purpose is a human
in a browser, `callback` needs the `code` that visit yields, and
`authenticate` is documented "opens browser" (`sdk.gen.d.ts:640`). The second
row is the contrast that closes the argument: with `oauth: false` the same
endpoint degrades to a clean `failed` with the HTTP error — **no discovery
ladder at all** (the endpoint saw only the connection attempts, no
`/.well-known` or `/register` hits) — which is the unattended shape §1.3
recommended and this run confirms: an unattended job either avoids OAuth
entirely or parks at `needs_auth` forever.

One operational footnote from the same run: after the permission-rejected
turn and `server.close()`, the MCP stdio child was still alive — `close()`
kills the server pid, not its tool children (the known `abort` vs `close()`
split, `opencode-agent/CLAUDE.md`), so a driver that spawns local MCP servers
must track their pids itself. The stray was reaped by its recorded pid.

---

## 3. The CI constraints applied per option

§1.4 recorded the constraints; this section applies them to the five candidate
surfaces the comparison core scores. Two constraints are **option-independent**
— they bind every surface equally, so they are stated once here rather than
repeated five times:

- **No interactive user is present.** Verified twice in §2.5: an OAuth-needing
  remote parks at `needs_auth` forever, and an `ask` grant deadlocks the turn
  on a permission request nothing answers. Whatever surface carries an `mcp`
  block, the block it carries must hold local servers or `oauth: false`
  remotes with static `headers`, and every grant must be `allow` or absent.
- **A broken server degrades; it never hangs the job.** Verified in §2.2: bad
  command, disabled, and hung children all settled to status data with the
  server and sessions unaffected — with the one caveat that a status poller
  must bound its own `GET /mcp` calls against the 30 s client-timeout floor.

The rest of §1.4 binds the options differently, and that difference is the
section. One evidence note first, so nothing below leans on a fact nobody
checked: **the merge-vs-override semantics between a checkout-local config
file and `OPENCODE_CONFIG_CONTENT` are recorded as pending, not settled** —
the plan's experiment for them (task 2.3) did not land its evidence, and
`design.md`'s risk table assumes it ran. Every claim below that would depend
on those semantics says so instead of asserting them.

### 3.1 Repo-committed config file (`opencode.json` in the checkout)

The file is **readable by the model** — `read` is granted in both profiles
(`openai-config.ts` `READ_TOOLS`), so anything committed in it is one tool call
away from the prompt. That is S3-7's class (§1.4 row 2: a credential in a file
the model can read), and the conclusion is the same one git credentials got:
**this surface must never carry a credential** — no real token in `headers`,
no secret in `environment`. On a repository that takes contributions the file
is also **attacker-influenceable via PR**: a contributor can propose an `mcp`
entry, and the pipeline would execute it in a privileged job the moment the PR
merges. Config arriving from the checkout is untrusted input in exactly the
way an issue body is — the difference is it arrives pre-approved by whoever
merges it. The load-bearing open question — whether such a file **merges with
or overrides** the pipeline's `OPENCODE_CONFIG_CONTENT` (provider pinning,
deny-by-default permissions) — is the pending experiment above; until it is
run, this option cannot be scored as either "harmless extra block" or
"smuggled override of the permission model", and the comparison core must
carry that as an explicit unknown, not a guess.

### 3.2 Pipeline env knob (`AGENT_*` style, e.g. `AGENT_MCP_SERVERS`)

Set through repository Actions variables/secrets — settings a maintainer
changes, not a commit a contributor proposes, so it is the one surface with no
PR-shaped attack path in this list. S3-9 still applies in full (§1.4 row 1):
the knob is merged into the config, the config is serialised into
`OPENCODE_CONFIG_CONTENT`, and that variable is model-readable by design —
**an MCP credential configured here is one `echo` away**, exactly as the
provider key was before `provider-proxy.ts`. Masking does not save it: GitHub
masks a registered secret in the log, but the value inside the config variable
is not "in the log" — it is in the server's environment (§1.4 rows 1 and 3).
Failure behaviour is the friendliest of the five: a malformed value fails at
job start in `config-values.ts`'s range-checking style, before any model turn
is spent, and a bad server degrades per §2.2 regardless of how its definition
arrived.

### 3.3 Repo file + Actions-secrets interpolation (`{env:VAR}`)

Splits §3.1's problem in two and solves only the git half: secrets never enter
the repository (they exist as job env, interpolated at load), so rotation is an
Actions-settings edit and history stays clean. The model-readability half is
**unsolved** — after interpolation the value sits in the config content, where
S3-9 puts it in the model's reach (§1.4 row 1), and the pipeline's
value-scrubbing keys off `pipelineSecrets(config)` (§1.4 row 3), which an
MCP-source credential would have to be wired into or it escapes every scrub.
The file itself remains PR-influenceable for its non-secret parts, and the
merge-vs-override question is exactly as pending as in §3.1 — interpolation
changes where values come from, not how a loaded file interacts with the
pipeline-owned config.

### 3.4 Forked workflow (user edits `agent-pipeline.yml`)

The escape hatch, and the only surface that can *install* things: a workflow
step can `bunx`/`npx` a stdio server or pin one from a lockfile, which matters
because the runner is ephemeral (§1.4 row 5) — **every server binary is
re-fetched every job, cold**, so supply-chain pinning and cold-start cost stay
permanently in the loop. It pays the drift tax the workspace already knows:
upstream workflow improvements must be re-merged by hand, and a fork that lags
misses the pipeline's own security fixes. Credential exposure is the S3-9
default again — workflow `env:` lands in the spawned server's inheritable
environment unless routed through the same containment the provider key uses.
Nothing here is unusable; everything here is worse than the env knob unless
the job genuinely needs an install step.

### 3.5 Issue/comment-level configuration — the constraints forbid it

Scored in the comparison core and rejected there on security grounds; this
section records that the CI constraints reach the same verdict first. Issue
authors and commenters are untrusted input (`prompts.ts`'s envelope exists for
them), and an `mcp` entry is *executable configuration*: a `local` entry is
arbitrary command execution in a privileged job, and a `remote` entry is an
exfiltration endpoint the runner will happily talk to — egress is unrestricted
(§1.4 row 4), so no network boundary would notice. The ephemeral runner
(row 5) removes even a per-repo allowlist as a mitigation: nothing persists to
accumulate trust in. No behavioural label needed on this half — none of it was
exercised against the binary, because the rejection is a design decision about
untrusted input, not an observation about the binary.

---

## 4. The comparison core — every candidate surface scored

One numbering note: the plan drew this as §2, but the live-evidence sections
(§2.1–§2.5) took the number first; the core sits here, after the constraints
it applies, and the closing sections follow as §5–§7.

The scoring dimensions were fixed before any option was ranked (design D5):
**what the user must know about pipeline internals; where the value lives and
how it is reviewed and changed; how secrets are supplied; what failure looks
like; and the CI-constraint and security assessment.** Every option below is
scored on exactly those five, in that order. Behavioural claims inherit their
labels from the section that established them (§2.x **verified** / **by
inspection**, §1.4 citations); statements about a *future* implementation are
marked **design intent** — they are what the option promises, not what the
binary was observed doing. The merge-vs-override unknown (§3 preamble) is
priced into the two scenarios it threatens rather than footnoted away.

### Scenario 1 — repo-committed config file (`opencode.json` in the checkout)

- **Must know:** OpenCode's config syntax and its file discovery, plus the
  fact that the pipeline *also* feeds config through
  `OPENCODE_CONFIG_CONTENT` — two sources the user cannot see interacting
  (the interaction itself is the pending experiment, §3.1).
- **Lives / review:** in git, PR-reviewable, per-repository — the best
  review story of the five on paper: a diff, a discussion, a merge.
- **Secrets:** none may ride here. The file is model-readable (`read` is
  granted in both profiles — §1.4 row 2), so a committed credential is S3-7's
  class of finding. **Verified** that config-content `environment` values do
  reach the server's child (§2.1's trace), which is the same channel a
  committed file's values would take.
- **Failure:** the server's own degradation is **verified** regardless of
  where its definition came from (§2.2). The *config* failure mode — what a
  contributor's syntax error or a smuggled key does to the pipeline's owned
  blocks — is the pending merge-vs-override question and cannot be claimed
  either way.
- **CI / security:** executable configuration arriving through PRs
  (§3.1) — pre-approved by merge, untrusted in any repository that takes
  contributions. **Blocked on the pending experiment**: until merge semantics
  are known, this option cannot be distinguished from "a contributor PR can
  override the deny-by-default permission model", and it scores as
  not-adoptable-now for that reason alone.

### Scenario 2 — pipeline env knob (`AGENT_MCP_SERVERS` in the `AGENT_*` style)

- **Must know:** one knob name and a JSON shape, documented in the README's
  existing knob table — the same knowledge surface as `AGENT_MAX_TOKENS` and
  friends. No workflow internals, no two-source interaction to reason about.
- **Lives / review:** repository Actions variables/secrets — a maintainer
  settings change, no commit, no PR. The one surface of the five with **no
  PR-shaped attack path** (§3.2).
- **Secrets:** the knob's value is merged into config content, and config
  content is model-readable by design (S3-9, §1.4 row 1) — **verified** as the
  channel (§2.1's `environment` trace). A credential here is one `echo` away
  unless the containment work lands; that risk and the deferred
  proxy-placeholder/scrubbing assessment are §7's, priced here as "no worse
  than the provider key pre-S3-9, and fixable by the same shape".
- **Failure:** malformed value → job start, `config-values.ts` range-check
  style, before any model turn (**design intent** — the knob does not exist
  yet); a bad *server* degrades per §2.2 (**verified**) whatever defined it.
- **CI / security:** grants stay pipeline-generated inside
  `buildOpencodeConfig`, so deny-by-default holds by construction and the
  `<server>_*` key form is **verified** (§2.4). Serves both execution paths
  from one definition (§6 pins the injection point). Cleanest failure, least
  knowledge, no new trust edge.

### Scenario 3 — repo file + Actions-secrets interpolation (`{env:VAR}`)

- **Must know:** Scenario 1's file syntax **plus** interpolation markers
  **plus** the Actions settings that fill them — the union of two worlds, and
  the failure needs both halves present at once.
- **Lives / review:** split: definitions in git (PR-reviewed), credentials in
  Actions settings (maintainer rotation, no commit). Rotation is genuinely
  better than Scenario 1; the review surface is the same file.
- **Secrets:** never enters git — the git half is solved. The model-read half
  is not: post-interpolation the value sits in config content where S3-9 puts
  it one `echo` away (§3.3), and `pipelineSecrets` wiring is as required as in
  Scenario 2. No better than Scenario 2 on the dimension that motivated it.
- **Failure:** Scenario 1's unknowns (merge semantics, §3.3) **plus** a new
  one: an env var missing at load time interpolates as what — empty, literal,
  or error — is **by inspection unknown**; nothing in this research
  exercised interpolation, and the option should not ship claiming a
  behaviour nobody ran.
- **CI / security:** non-secret parts remain PR-influenceable (§3.3); the
  smuggle-in-config question is exactly Scenario 1's, unresolved.

### Scenario 4 — forked workflow (user edits `agent-pipeline.yml`)

- **Must know:** workflow YAML, the job's steps, install/pinning mechanics —
  the most pipeline internals of the five.
- **Lives / review:** a fork of the workflow file; every upstream improvement
  re-merged by hand (§3.4). Powerful and permanently out of drift-lockstep.
- **Secrets:** workflow `env:` lands in the spawned server's inheritable
  environment unless routed through provider-proxy-style containment (§3.4) —
  the S3-9 default, with the same deferred fix.
- **Failure:** an install step that fails kills the job before any model turn
  (**design intent** — that is what a workflow step does); server behaviour
  after a successful install is §2.2's **verified** degradation. Cold fetch
  every job (§1.4 row 5) makes install flakiness a per-job tax.
- **CI / security:** the only surface that can *install* server binaries —
  supply-chain pinning in the loop, re-fetched cold every run (§3.4). Records
  as the escape hatch: right answer when a stdio server genuinely needs
  installing, wrong answer as the default.

### Scenario 5 — issue/comment-level configuration — scored, then rejected

- **Must know:** a command syntax — the friendliest UX of the five, which is
  exactly why it must be refused.
- **Lives / review:** the issue thread; instant, no maintainer gate at all.
- **Secrets:** moot — the source is untrusted before secrets even enter.
- **Failure:** moot in the useful sense: nothing to observe because nothing
  may run.
- **CI / security: rejected on security grounds, on record** (D5 requires the
  rejection be a finding, not an omission): an `mcp` entry is *executable
  configuration*, and this surface hands its authorship to the two populations
  the pipeline already treats as untrusted input — issue authors and
  commenters (`prompts.ts`'s envelope exists for their text). A `local` entry
  is arbitrary command execution in a privileged job; a `remote` entry is an
  exfiltration endpoint over unrestricted egress (§1.4 row 4, §3.5). **No
  behavioural label applies — the verdict is a design decision about
  untrusted input, not an observation about the binary.**

### The scores side by side

| Dimension                      | S1 repo file | S2 env knob | S3 file+interp | S4 fork wf | S5 issue/cmd |
| ------------------------------ | ------------ | ----------- | -------------- | ---------- | ------------ |
| Knowledge required             | mid, 2-source | **least**   | most, 2-worlds | most, YAML | least (moot) |
| Where it lives / review        | **git, PR**  | Actions only | split          | forked wf  | thread (moot) |
| Secrets story                  | none allowed | content risk | git ok, content risk | content risk | moot |
| Failure shape                  | pending merge | **job start** | pending + interp unknown | install-time | moot |
| Trust edge added               | PR authors   | **none**     | PR authors     | workflow owner | **everyone** |
| Verdict                        | blocked on 2.3 | **adopt**    | dominated by S2 | escape hatch | **rejected** |

Two readings of the table. Scenario 3 is **dominated** by Scenario 2 on every
dimension except git-visibility of definitions — it costs Scenario 1's unknowns
plus interpolation's, to end at the same content-risk as the knob. Scenario 1's
git-review advantage is real but held hostage to the merge-vs-override
experiment: if a committed file turns out to override pipeline-owned config,
the "reviewable" surface is precisely the smuggling channel. The ranked
recommendation and the deferred follow-ups close the document (§7).

---

## 5. Interaction with the deny-by-default permission model

The model, restated in one line: every profile `openai-config.ts` emits is
built by `grant()` — `"*": "deny"` first, named allows after — and MCP tools
join the table under their `<server>_<tool>` names (**verified**, §2.1). The
interaction, each half carrying its evidence:

- **MCP tools are inside deny-by-default.** **Verified** (§2.1): a connected
  server's tools were absent from the `build` agent's model-visible table
  until a grant key named them. A server the pipeline spawns but never grants
  is inert for the model — the strongest containment this design has, and it
  costs nothing extra.
- **The grant key form is the tool-name wildcard.** **Verified** (§2.4):
  `"<server>_*": "allow"` in a profile's map resolves to
  `{permission: "<server>_*", pattern: "*", action: "allow"}` and admits the
  server's whole toolset; an exact `<server>_<tool>` key admits exactly that
  tool; the bare server name is a **silent no-op** — accepted as a rule,
  grants nothing — so wherever the key is generated deserves a one-line guard
  (**design intent**).
- **The grant must live in each profile's own map.** **Verified** (§2.4): a
  global-block `research_*` allow is cancelled for any agent whose own map
  ends in `"*": "deny"` — the resolved list is an ordered concatenation and
  the later rule wins. A global-only grant would be a no-op for every agent
  the pipeline prompts.
- **`ask` is forbidden for MCP keys** as for built-ins. **Verified** (§2.5):
  an `"ask"` grant parks the turn on a permission request nothing unattended
  answers. An MCP entry is `allow` or absent, never `ask`.

**Recommended grant shape** (the maintainer decision recorded per design D6;
mechanics verified per above): the `<server>_*` wildcard **in both profiles'
maps and in the global default**. The load-bearing half is the profile maps —
`plan` and `build` each carry the key beside their existing allows, emitted by
the same `grant()` call that builds the rest. The global-default half reaches
only the unnamed built-ins (`title`, `summary`, `compaction`, …) that inherit
it; giving them a granted server is harmless for `title`/`summary` (they
generate text from the session, not tools) and consistent — one server, one
key, three places, no per-profile forgetting. Composition note for honesty:
the live runs verified the pieces (profile-map wildcard on `build`, exact-name
on `plan`, global-only reaching unnamed agents) rather than the combined
three-place shape end to end; the composition follows from the verified
mechanics, and §1.1's re-verification note includes it.

**Opt-out is a named follow-up, not designed here** (proposal Non-goals): a
future per-server or per-profile opt-out knob narrows the grant without
touching the model. Until it exists the shape is grant-all-configured, and an
operator who wants a server invisible to `plan` configures it… not at all —
the wildcard is the only shape shipped.

## 6. Where the `mcp` block is injected, per option, for both execution paths

The two paths and their one shared seam (**by inspection** of the pinned
code, lines cited):

- **In-process session**: `opencode-connect.ts:100–104` hands
  `createOpencodeServer({ config: buildOpencodeConfig(openai) })` — the
  config object, directly.
- **Review-loop subprocesses**: `openai-config.ts:296–299`
  (`opencodeConfigEnv`) serialises **the same** `buildOpencodeConfig` output
  into `OPENCODE_CONFIG_CONTENT`, which `review-runner.ts:196–197` passes as
  `env` to the loop, whose `agent-runner.ts:153–160` spawns
  `opencode run … --dir <repoRoot>` inheriting it.

One builder serves both — the workspace's single-definition rule
(`openai-config.ts`'s own doc comment) — so **the only injection point that
cannot drift is inside `buildOpencodeConfig`**: an `mcpServers` field on
`OpenAiSettings` (the way `profiles` rides today), merged into the emitted
config, with §5's grant keys added by the same `grant()` calls that build
each profile. Both paths then carry it by construction; neither can see a
different server set than the other.

Per option:

- **S2 env knob**: exactly the above — parse in `config-values.ts` style,
  ride on settings, emit in `buildOpencodeConfig` (**design intent**; the
  verified fact underneath is that both paths read the one builder).
- **S1 / S3 repo file**: *no injection point of ours exists* — the binary
  loads the file through its own discovery in whatever `--dir`/directory the
  server runs in. Whether that load **merges with or overrides**
  `OPENCODE_CONFIG_CONTENT` — and whether the review-loop subprocesses (same
  env var, `--dir repoRoot`) see the checkout file at all — is the pending
  2.3 experiment (§3 preamble). Until run, the honest statement is: unknown,
  and the option's security story cannot be written either way.
- **S4 forked workflow**: injection is a workflow `env:` or an install step —
  **outside** the single builder, drifting from the in-process path by
  construction unless the fork also routes through the knob. That drift is
  part of the escape hatch's cost.
- **S5 issue/comment**: rejected (§4, Scenario 5); no injection point may
  exist.

## 7. Credential exposure per option, the recommendation, and the follow-ups

**Exposure risk per option** — the deferred containment assessment stated
once, then priced in:

The deferred question (proposal Non-goals, design D6): does the
`provider-proxy.ts` loopback-placeholder pattern generalise to MCP — a proxy
holding the real `headers` token while the config carries a placeholder — and
does `secrets.ts`/`pipelineSecrets` value-scrubbing cover MCP-sourced
credentials? **Deferred, not designed here.** What can be said without
designing it: the provider proxy proves the *shape* works for one HTTP
authorization header on one loopback route; MCP remotes multiply the routes
(per-server), local servers move the credential into a child's `environment`
(**verified** reachable, §2.1), and both land inside the config content the
model can read (S3-9, §1.4 row 1). Until the generalisation lands, every
option below carries the same residual risk: **an MCP credential that reaches
config content is one `echo` away** — exactly the provider key pre-S3-9.

| Option | Where a credential would sit | Exposure |
| ------ | ---------------------------- | -------- |
| S1 repo file | in the file itself | **worst**: model-readable *file* (§1.4 row 2) + git history; must be forbidden outright |
| S2 env knob | config content via the knob | content risk only; fixable later by the same shape that fixed the provider key |
| S3 file + `{env:VAR}` | config content post-interpolation | same content risk as S2, plus the file's other risks (§4) |
| S4 forked workflow | workflow `env:` → inherited environment | inherited-env risk (S3-9's original channel); routing through containment is the fork's job |
| S5 issue/comment | — | rejected; moot |

**Recommendation** (ranked, from §4's table):

1. **Adopt the `AGENT_*` env knob** (`AGENT_MCP_SERVERS`, JSON, merged in
   `buildOpencodeConfig` — §6's single seam). Least knowledge, no PR trust
   edge, best failure shape, both paths by construction, and its credential
   risk is the one the codebase already knows how to reason about.
2. **Record the repo-committed file as blocked on the 2.3 experiment**, not
   rejected: if merge semantics come back benign (content merges, file cannot
   override pipeline-owned blocks), its git-review story justifies a revisit;
   if they do not, the §4 Scenario 1 security note is the rejection.
3. **Forked workflow stays the escape hatch** for jobs that must install a
   stdio server binary; the env knob plus a pinned `bunx`-style command
   inside `McpLocalConfig.command` covers most of that ground without the
   fork.
4. **Issue/comment-level configuration is rejected** on the security grounds
   recorded in §4 Scenario 5 — a decision, not a ranking.

**Named follow-ups** (each deferred with its risk documented, none designed
here):

- **Per-server opt-out knob** — narrows §5's grant-all-configured shape
  (proposal Non-goals).
- **Credential containment for MCP `headers` / `environment`** — the
  proxy-placeholder/scrubbing generalisation assessed above; until it lands,
  the recommendation is the same one S3-9 taught: prefer **unauthenticated
  local servers and static-token remotes you can afford to expose**, because
  the content channel is model-readable.
- **The missing merge-vs-override experiment** — task 2.3's evidence never
  landed (§3 preamble); running it is what unblocks recommendation 2, and it
  should also answer the second half: do review-loop subprocesses see a
  checkout-local config file at all.
- **Grant-key typo guard** — reject a bare server name at knob-parse time
  (§2.4's silent no-op), one line in the future `config-values.ts` parsing.

A later pin bump re-verifies, at minimum: the §1.2/§1.3 anchors, every
**verified** claim in §2, and §5's combined grant shape end to end (§1.1's
re-verification note).


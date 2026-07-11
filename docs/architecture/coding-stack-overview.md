<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# The Coding-Session Stack: papai → magi → geofront

> A cross-service architecture reference for the three projects that together turn a
> natural-language chat message into a sandboxed AI coding session that opens a pull
> request. Compiled from source of all three repositories:
>
> - **papai** — `/Users/ki/Projects/yourpapai/papai` (this repo; the chat bot + orchestrator)
> - **magi** — `/Users/ki/Projects/yourpapai/magi` (the ACP control service)
> - **geofront** — `/Users/ki/Projects/experiments/geofront` (the Rust sandbox launcher)
>
> Companion docs: `docs/architecture/coding-sessions.md` (papai's plugin/credentials view),
> `docs/architecture/overview.md` (papai request flow). magi's own docs live under
> `magi/docs/`; geofront's under `geofront/docs/` (ADRs + specs).

> **Doc-vs-code drift note.** papai's `coding-sessions.md` still references a
> `review_pr` tool, a magi `shareToken`, and magi `/t/:token/*` endpoints. As of the
> current code these are **stale**: the standalone review path was deleted and folded
> into `prNumber` on `POST /sessions`; magi exposes bearer-gated `/sessions/:id/transcript`
> and `/sessions/:id/stream` (no token-scoped route, no `shareToken`). This document
> describes the **code-verified current state** and flags drift inline. See §7.

---

## 1. What the stack is for

A user chats with the papai bot (Telegram / Mattermost / Discord / Kontur Talk) and says
something like _"work on issue X in repo Y"_ or _"review PR #42"_. The LLM decides to call a
coding tool. From there:

1. **papai** (chat bot + LLM orchestrator) resolves the user's credentials and repo
   catalogue, builds a `projectSpec`, and makes an authenticated HTTP call to magi.
2. **magi** (ACP control service) prepares an isolated git worktree/branch, and asks
   geofront to launch a coding agent inside a hardened sandbox. It speaks the **Agent
   Client Protocol (ACP)** to that agent over a Unix socket, gating the agent's permission
   requests by policy, streaming a transcript, and on finish committing + pushing the
   branch and opening/updating a PR/MR.
3. **geofront** (Rust CLI) is the sandbox: it runs the agent inside a Docker container with
   dropped capabilities, a non-root user, a **deny-by-default egress proxy**, and (in strict
   mode) in-container `iptables` lockdown — so the agent can reach only an operator-bounded
   allowlist of hosts and holds no secrets.

Each layer distrusts the one below/inside it. papai never gives the sandbox a forge token;
magi re-validates every field papai sends; geofront assumes the agent is compromised.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ USER (Telegram / Mattermost / Discord / Kontur Talk)                           │
└───────────────┬────────────────────────────────────────────────────────────────┘
                │ natural language
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ PAPAI  (Bun + TS)  — chat bot + LLM tool-calling orchestrator                   │
│   plugins/acp/  ── stateless HTTP client of magi                                │
│     • resolves per-identity coding credentials (provider key, forge token, MCP) │
│     • builds projectSpec, injects thread-scoped storageContextId as contextId   │
│     • serves the public /t/<token> transcript viewer (proxies magi, bearer-authed)│
└───────────────┬────────────────────────────────────────────────────────────────┘
                │ HTTPS + Bearer MAGI_API_TOKEN   (POST /sessions, /finish, …)
                │ ◄──── outbound webhook: magi → papai POST /api/notify (milestones)
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ MAGI  (Bun + TS)  — ACP control service                                         │
│   • session state machine + SQLite store                                        │
│   • git worktrees over a shared bare mirror; forge (GitHub/GitLab) push + PR     │
│   • re-validates untrusted projectSpec (SSRF allowlist, agent allowlist)         │
│   • speaks ACP to the agent; parks/resolves permission requests by preset        │
│   • MCP broker: per-upstream credential-holding worker enclosures + mediator     │
└───────────────┬────────────────────────────────────────────────────────────────┘
                │ shells out:  geofront workspace up --acp <sock> [--mcp-mount <sock>]
                │ ACP JSON-RPC over the Unix domain socket
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ GEOFRONT  (Rust)  — sandbox launcher (Docker runtime)                            │
│   • agent container: --cap-drop ALL, no-new-privileges, non-root, minimal mounts │
│   • egress-proxy container: deny-by-default 3proxy + dnsmasq sinkhole            │
│   • strict egress: in-container iptables OUTPUT=DROP except proxy IP:port        │
│   • egress ceiling (org-layer) ∩ requested allowlist                            │
│   • --acp byte-relay bridges agent stdio ↔ host Unix socket (verbatim, no parse) │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The three services at a glance

|                    | **papai**                                                                    | **magi**                                                                       | **geofront**                                         |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Language / runtime | Bun + TypeScript                                                             | Bun + TypeScript                                                               | Rust (edition 2024, `unsafe_code = forbid`)          |
| Role               | Chat bot + LLM orchestrator; owns user identity, credentials, repo catalogue | ACP control service; owns session lifecycle, git, forge, sandbox orchestration | Sandbox launcher; owns container + network isolation |
| Trust stance       | Distrusts the sandbox (never sends forge token _to_ the agent)               | Distrusts papai's payload (`validateRepoSpec` re-parses everything)            | Distrusts the agent (assumes compromise)             |
| Persistence        | SQLite (encrypted config, `plugin_kv`, credentials vault)                    | SQLite (session store, `MAGI_DB`)                                              | None (host cache dirs only)                          |
| Entry point        | `src/index.ts`; acp plugin `plugins/acp/`                                    | `bun src/main.ts serve`                                                        | `geofront workspace up` binary                       |
| Auth to next layer | Bearer `magi_token` (plugin admin config)                                    | Bearer forge token via git askpass; `--acp`/`--mcp-mount` sockets              | n/a                                                  |
| Distribution       | —                                                                            | systemd unit (`deploy/magi.service`)                                           | npm `@idevops_dev/geofront`, APT, `cargo build`      |

---

## 3. papai — chat bot & orchestrator (the entry layer)

Full detail: `docs/architecture/overview.md`, `docs/architecture/coding-sessions.md`, and
the path-scoped `CLAUDE.md` files. Only the coding-session-relevant surface is summarized
here.

### 3.1 Request flow (coding-session path)

```
User message → ChatRouter → source ChatProvider instance
  → bot.ts (queue, auth, reply-context)
    → llm-orchestrator.ts → makeTools(provider, { storageContextId, chatUserId, … })
       → the acp plugin's tools are added to the toolset (capability-gated)
    → LLM calls e.g. plugin_acp__start_session
       → plugins/acp/ resolves credentials + builds projectSpec → HTTP → magi
    → reply via ReplyFn (includes the transcriptUrl when magi returns one)
```

Non-command text goes straight to the LLM queue; if a run is already active for that
context the message is injected as **mid-run steering** instead of starting a new turn.

### 3.2 The `plugins/acp/` plugin

A thin **first-party plugin** and a **stateless HTTP client of magi**. Because plugin source
cannot static-import bare modules (discovery rejects them), its tools use raw JSON-Schema
`inputSchema` with manual guards — no Zod, no `src/` imports; it uses structural types
throughout.

- **Admin config** (`magi_base_url`, `magi_token`): admin-scoped base URL + sensitive token,
  read via `readMagiConfig` (`plugins/acp/client.ts`). Outbound calls go through
  `providerRuntime.httpFetch`, with the base URL allowlisted via
  `providerAllowedHostsFromConfig`. `callMagi()` wraps every request: `Authorization: Bearer
<token>`, JSON body, and normalizes non-2xx into `{ error: 'magi_error', status, body }`.
- **contextId injection**: the chat's **thread-scoped** `storageContextId` is sent as magi's
  session `contextId`, so magi's milestone notifier can post back to the _originating thread_
  (not the group channel). The plugin runtime receives the raw thread-scoped id even though
  the manifest sets `storageScope: 'group'` — group scope only remaps `plugin_kv` so
  `list_sessions` stays shared across a group's threads.

### 3.3 LLM tools exposed (`plugins/acp/session-tools.ts`, `tools.ts`, `continue-tool.ts`)

| Tool                | magi call                                                     | Notes                                                                                                                                   |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `start_session`     | `POST /sessions`                                              | project + prompt; optional `prNumber` to start on an existing PR/MR (review or edit-and-push, decided by the repo's `permissionPreset`) |
| `list_sessions`     | `GET /sessions?filter=`                                       | filtered to sessions **this chat started** (intersect magi rows with local `plugin_kv` `session:` keys)                                 |
| `session_status`    | `GET /sessions/:id`                                           |                                                                                                                                         |
| `finish_session`    | `POST /sessions/:id/finish`                                   | `action: push \| pr`; requires a forge token                                                                                            |
| `cancel_session`    | `POST /sessions/:id/cancel`                                   |                                                                                                                                         |
| `answer_permission` | `GET …/permissions` then `POST …/permission` per `toolCallId` | allow/deny all pending                                                                                                                  |
| `continue_session`  | `POST /sessions/:id/follow-up`                                | iterate on a prior session's branch/PR; resolves parent by `sessionId` or by `prNumber` scoped to this chat's sessions                  |
| `list_projects`     | (local)                                                       | reads the repo catalogue from settings, no magi call                                                                                    |

> **Drift:** `coding-sessions.md` mentions a `review_pr` tool. There is **no** `review_pr`
> tool in the current code — review is `start_session` with `prNumber`.

### 3.4 The `projectSpec` papai builds (`buildSessionProjectSpec`, `plugins/acp/tools.ts`)

```jsonc
{
  "name": "<repo catalogue name>",
  "repoUrl": "https://github.com/org/repo",
  "baseBranch": "main",
  "permissionPreset": "autonomous | cautious | readonly",
  "agent": "claude | codex | opencode", // resolved coding agent
  // present only when configured / resolvable:
  "forge": { "kind": "github | gitlab", "apiBaseUrl": "https://api.github.com" },
  "providerHost": "api.anthropic.com", // derived from provider + base URL
  "model": "claude-sonnet-4-6", // identity-context only
  "additionalEgressDomains": ["extra.host"], // additive, still bounded by ceiling
  "mcp": [
    // multi-server (see §3.6)
    {
      "id": "jira",
      "url": "https://…",
      "host": "…",
      "header": "Authorization",
      "allowedHosts": ["…"],
      "toolPolicy": { "default": "deny", "tools": { "search": "allow" } },
    },
  ],
}
```

The full `POST /sessions` body wraps this: `{ agent, contextId, prompt, secrets,
forgeToken?, prNumber?, projectSpec, mcpTokens? }`. `secrets` (the provider LLM key) and
`mcpTokens` (per-MCP-server upstream credentials) ride **outside** `projectSpec` so magi can
route them into the sandbox/worker via its staged-secret channel — they never enter
`projectSpec` egress derivation as data.

### 3.5 Per-identity credentials vault (`src/coding-credentials/`)

The `coding_session_credentials` vault is resolved per-identity by `resolve-agent-secrets.ts`
and threaded to the plugin via `buildCodingSecretsFacade` (`codingSecrets` capability, gated
by `coding.secrets`). Namespaces:

- **`agent-provider`** — the sandboxed agent's LLM key + choice of coding agent. Fields:
  `agent` (`claude`/`codex`/`opencode`), `provider` (`anthropic`/`openai`/`openai-compatible`),
  `provider_api_key`, `provider_base_url`, optional `model`. A `compatible(agent, provider)`
  rule constrains pairs (claude→anthropic; codex→openai/openai-compatible; opencode→any);
  `openai-compatible` requires a base URL. `resolveAgentSecrets` maps `provider →
{ANTHROPIC_API_KEY, OPENAI_API_KEY}`; `resolveProviderHost` derives the model hostname (used
  for egress). `start_session` refuses with `error: 'not_configured'` when empty.
- **`forge`** — the user's code-host token (GitHub/GitLab PAT). Fields: `kind`
  (`github`/`github-enterprise`/`gitlab`/`gitlab-self-hosted`), `instance_url` (self-hosted
  only), `forge_token`. `resolveForge` → `{ kind, apiBaseUrl }`; `deriveApiBaseUrl` maps
  kind+instance_url to the API base. `finish_session`/`continue_session` refuse without it,
  preventing push/PR without the user's identity. `start_session` pre-flights self-hosted
  repos (`canDeriveForge`): a non-SaaS repo host with no forge config refuses locally rather
  than letting magi 400.
- **`mcp`** — the user's per-session MCP selections (multi-server; see §3.6).

**Guardrails (operator, per platform instance)** — `src/coding-credentials/guardrails.ts`:
`allowedAgents` (which agents users may pick; magi re-enforces via `validateRepoSpec`),
`whoMayUse` (`'members'` | allowlist; filters the 6 session-action tools host-side in
`buildFullToolSet`), `forceSharedKey` (read the operator's `agent-provider` vault instead of
the user's — forge always stays per-user). **Group identity** — `coding_identity`
(`initiator` (default) / `shared` / `designated:<userId>`) picks whose vault a group session
reads; `identityContext()` resolves it and threads it through all resolvers.

### 3.6 Multi-server MCP selection (current code)

> This supersedes the single-server `mcp` description in `coding-sessions.md` §"Sandbox MCP
> broker" (Phase 3A/3B). The vault now holds **an array** of selections and papai sends
> `mcp: McpUpstream[]` + `mcpTokens: Record<id, token>`.

- Operator publishes a vetted **catalog** (`mcp_catalog`, admin config keyed
  `__admin_mcp_catalog__:<platformInstanceId>`, `src/coding-credentials/mcp-catalog.ts`) — each
  entry `{ name, upstream_url (https), header?, default_tool_policy (required), tool_policy? }`;
  `host`/`allowedHosts` are **derived** from `upstream_url`, so a host/URL mismatch can't exist.
  Fallback tool policy is `deny` (secure-by-default).
- Users select entries in their **"Coding MCP servers"** section; the vault stores only the
  choice (`{ server, upstream_token }`), never a URL. `resolveMcpServers`/`resolveMcpTokens`
  (`src/coding-credentials/resolve-mcp-servers.ts`) treat the **catalog as authoritative**:
  they look up the stored `server` in the platform instance's _current_ catalog and derive
  `{ url, host, header, allowedHosts, toolPolicy }` from it — never from the vault, so the
  catalog can't drift out of sync with what a session gets. A removed/renamed server →
  fail-closed (that selection contributes nothing).
- papai can also expose a **first-party plugin as an MCP upstream** at `/mcp/plugin/<pluginId>`
  (`src/mcp-server/`, opt-in manifest flag `mcpServer: true`), gated by a stateless signed
  bearer token (`mintPluginMcpToken`, 30-day TTL, HMAC of `INSTANCE_CONFIG_KEY` or
  `MCP_SERVER_SIGNING_SECRET`). Selecting `mcp.server = 'plugin:<id>'` stores no
  `upstream_token`. Exposure is re-checked on every redemption, so disabling a plugin server
  takes effect immediately regardless of the token's TTL.
- A plugin can additionally opt into **bridge-level response redaction** with manifest flag
  `mcpResponseRedaction: true`: `callPluginMcpTool` (`src/mcp-server/plugin-bridge.ts`) runs the
  tool's JSON result through `src/mcp-server/redaction.ts` before it reaches the coding agent.
  This requires operator `mcp_redaction` admin config (`src/coding-credentials/mcp-redaction.ts`)
  and is fail-closed at both call time (a redacting plugin without config returns a blocked
  result) and at server-selection time (`listEnabledInternalMcpServers` in
  `src/coding-credentials/mcp-plugin-servers.ts` excludes the plugin until configured). The
  `mcp-sentry` plugin (`plugins/mcp-sentry/`) is the first first-party MCP plugin migrated onto
  this pattern — 7 read-only Sentry issue-diagnosis tools. `mcp-confluence`
  (`plugins/mcp-confluence/`) is the second — 5 Confluence wiki read/comment tools over HTTP
  Basic auth, responses redacted the same way. `mcp-figma` (`plugins/mcp-figma/`) is the
  third — 7 Figma file/node/style/component/comment tools authenticated via `X-Figma-Token`;
  it does not opt into `mcpResponseRedaction` (design metadata, not customer data) and is the
  first of the three with a context-scoped (per-team) rather than admin-scoped credential.

### 3.7 Transcript viewer (papai-side)

`src/debug/transcript-viewer.ts` serves a **public, token-gated** SPA: `/t/<token>` (shell),
`/t/<token>/transcript` (paged JSON), `/t/<token>/stream` (SSE), plus `/t.js`/`/t.css`. These
are mounted **before** the dashboard auth gate — possession of the opaque token _is_ the
access control (like magi's own bearer-gated endpoints). The proxy reads `magi_base_url`/
`magi_token` from the acp plugin admin config and forwards **bearer-authed** requests to magi;
magi's URL/token never reach the browser. The stream proxy binds directly to the client's
`req.signal` (not the 30s-capped `httpFetch`) so long sessions stream to the tab's lifetime.

> **Drift / reconciliation:** `coding-sessions.md` says papai proxies to magi's
> `/t/:token/{transcript,stream}` and that magi mints a `shareToken`. The **current magi
> code** has no `/t/:token` route and no `shareToken` — its transcript endpoints are the
> bearer-gated `GET /sessions/:id/transcript` and `GET /sessions/:id/stream` (§7.7). Treat any
> `transcriptUrl` as a bearer secret regardless; the log is raw and unredacted.

### 3.8 The `plugins/nerv/` plugin (supervised coding tasks)

A sibling of `plugins/acp/` and a stateless HTTP client of **nerv**, the stateful supervisor tier
(`papai → nerv → magi → geofront`). Where acp runs a **one-shot** coding session, nerv drives a
**long-running, supervised** GitLab-MR task: it opens/updates a merge request and watches it until CI
is green, ingesting review comments and iterating. The plugin exposes six LLM tools —
`create_coding_task`, `coding_task_status`, `list_coding_tasks`, `followup_coding_task`,
`steer_coding_task`, `cancel_coding_task` — mapping to nerv's `POST /tasks`, `GET /tasks/:id`, and
`POST /tasks/:id/events`. Admin config `nerv_base_url`/`nerv_token` (bearer, allowlisted via
`providerAllowedHostsFromConfig`), same shape as acp's `magi_*`.

- **contextId round-trip**: the chat's thread-scoped `storageContextId` is sent as
  `contextRef.contextId`; nerv stores it, forwards it to magi, and relays milestones back through
  papai's **existing** `/api/notify` (papai `NOTIFY_TOKEN` == nerv `PAPAI_NOTIFY_TOKEN`). magi's
  `MAGI_NOTIFY_URL` points at **nerv**, not papai — so papai only ever hears from nerv for
  supervised tasks. No papai inbound code changed.
- **One task per thread**: nerv correlates a task 1:1 by `contextId`, so the plugin keeps a
  group-scoped local record (`task:<id>`) plus an `active:<thread>` pointer; follow-up/steer/cancel
  auto-resolve the thread's task. `create_coding_task` refuses while a non-terminal task is live.
- **projectPath** is derived from the reuse of papai's coding-repo catalogue (`codingRepos`, gated by
  `coding.secrets` — used **only** for the repo lookup; nerv owns the forge/magi credentials, so the
  plugin passes no user secrets). GitHub repos are refused (nerv is GitLab-only today).
- **Gating**: the four nerv action tools join acp's in the operator `whoMayUse` guardrail via
  `CODING_ACTION_TOOLS` (`src/llm-orchestrator-tools.ts`); status/list stay ungated.

Design + plan: `docs/superpowers/specs/2026-07-09-papai-nerv-plugin-design.md`,
`docs/superpowers/plans/2026-07-09-papai-nerv-plugin.md`.

---

## 4. magi — the ACP control service (the middle layer)

Root: `/Users/ki/Projects/yourpapai/magi`. Bun + TypeScript, **no build step**
(`bun src/main.ts serve`). ESM/NodeNext — relative imports carry `.js` even in `.ts`.

### 4.1 Module map (`src/`)

- `server/` — HTTP layer: `router.ts` (route table, `createFetchHandler`), `server.ts`
  (`Bun.serve`), `sse.ts` (SSE streaming), `rate-limit.ts` (fixed-window).
- `session/` — the orchestration core: `state.ts` (state machine), `manager.ts` +
  `lifecycle.ts` (run orchestration), `helpers.ts`, `auto-finish.ts`, `auto-publish.ts`,
  `pr-description.ts`, `lineage.ts`, `store.ts` (SQLite via `bun:sqlite`), `hub.ts` (pub/sub),
  `reaper.ts`, `broadcast-recorder.ts`, `transcript.ts`, `transcript-reader.ts`,
  `session-state.ts` (agent-home shuttling for resume).
- `project/` — `config.ts` (types + egress derivation), `spec-validation.ts` (the untrusted-
  payload trust boundary).
- `permission/` — `engine.ts` (park/resolve TTL engine), `policy.ts` (`decidePolicy` per preset).
- `workspace/` — `git-workspace.ts` (`GitWorkspaceManager`: worktrees over a shared bare mirror).
- `git/git.ts` — low-level git exec with askpass auth injection.
- `forge/` — `Forge` interface + `github.ts`/`gitlab.ts` + shared `http.ts`.
- `runtime/` — `runtime.ts` (interface); `geofront/` (real runtime + provisioning + MCP
  apparatus); `stub/` (dev/test runtime). Selected by `MAGI_RUNTIME`.
- `launcher/`, `acp/` (`client.ts` `runAcpSession`, resume, `select-model.ts`).
- `mcp-broker/` — the credential-isolation subsystem (§6.3).
- `notify/notifier.ts` — outbound milestone webhook to papai.
- `main.ts` — wiring, `selectRuntime`, `assertServeReady`.

### 4.2 HTTP API surface (`src/server/router.ts`)

Every route except `GET /health` requires `Authorization: Bearer <MAGI_API_TOKEN>` (checked
before path dispatch, so any unauthenticated path uniformly 401s).

| Method | Path                                     | Purpose                                                                                                                                                                                        |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                                | liveness, **no auth**                                                                                                                                                                          |
| GET    | `/agents`                                | `[{ name: <first configured agentEntrypoint> }]`                                                                                                                                               |
| POST   | `/sessions`                              | **start**: body `{ contextId, prompt, projectSpec, secrets?, forgeToken?, mcpTokens?, prNumber? }`; validates via `validateRepoSpec`, rate-limits on `contextId`, returns `202 { id, status }` |
| GET    | `/sessions?filter=`                      | list by `new\|active\|waiting\|done` (default `active`)                                                                                                                                        |
| GET    | `/sessions/:id`                          | fetch one                                                                                                                                                                                      |
| GET    | `/sessions/:id/permissions`              | pending permission requests (`manager.pendingFor`)                                                                                                                                             |
| POST   | `/sessions/:id/permission`               | body `{ toolCallId, decision: allow\|deny }` → resolves a parked request                                                                                                                       |
| POST   | `/sessions/:id/cancel`                   | cancel a running session                                                                                                                                                                       |
| POST   | `/sessions/:id/finish`                   | body `{ message, action: push\|pr, title?, body?, forgeToken? }`                                                                                                                               |
| POST   | `/sessions/:id/follow-up`                | body `{ prompt, contextId?, forgeToken?, secrets?, mcpTokens? }`; re-validates parent's stored `projectSpec`; `409` if parent not `CONTINUABLE`                                                |
| GET    | `/sessions/:id/transcript?after=&limit=` | paged JSONL transcript (`readTranscriptPage`)                                                                                                                                                  |
| GET    | `/sessions/:id/stream`                   | SSE live transcript (`streamResponse`)                                                                                                                                                         |

> **Corrections vs. papai's `coding-sessions.md`** (verified by full read + repo-wide grep of
> magi): there is **no** `/reviews` route (deleted; folded into `prNumber` on `/sessions` — see
> `magi/docs/superpowers/plans/2026-07-07-session-from-existing-pr.md`), **no** `POST
/sessions/:id/answer` route (`'answer'` is only an outbound `MilestoneKind`), **no** inbound
> `/api/notify` on magi (that's an _outbound_ call magi makes into papai), and **no**
> `/t/:token/*` route or `shareToken` concept. `MilestoneKind` still declares an unemitted
> `'review_posted'`/`'review'` vestige of the removed review path.

### 4.3 Session state machine (`src/session/state.ts`)

`SessionStatus`: `queued | preparing | running | waiting_permission | waiting_input |
finishing | done | failed | cancelled`.

```
queued ─▶ preparing ─▶ running ─▶ waiting_permission ─▶ running
  │           │           │  │            (loop)
  ▼           ▼           │  ├─▶ waiting_input ─▶ running | finishing | done
failed      failed        │  └─▶ finishing ─▶ done
cancelled   cancelled     ▼
                        failed | cancelled
   (done | failed | cancelled are terminal)
```

Enforced by `canTransition` against a `TRANSITIONS` table. `StopReason` (`end_turn |
cancelled | max_tokens | max_turn_requests | refusal`) maps via `statusForStopReason`:
`end_turn`→`waiting_input`; `cancelled`→`cancelled`; token/turn/refusal→`failed`.

`CONTINUABLE = { waiting_input, done, failed, cancelled }` — the statuses a session may be
**followed-up** from; anything still active rejects `/follow-up` with `409`.

### 4.4 Session lifecycle (`SessionManager` / `lifecycle.ts`)

`startSession` → `runLifecycle`:

1. **Prepare workspace** — `prepareCheckedOutWorkspace` (new branch `acp/<sessionId>`), or
   **PR-adoption** when `prNumber` is set: `forge.getPullRequest(prNumber)` →
   `resolveCheckoutBranch` → `workspace.prepareContinue` onto the PR's real head branch.
2. **Build launch spec** — `buildLaunchSpec` (provisioning plan, egress, secrets).
3. **Provision + launch** the runtime (geofront) — see §5.
4. **Run the turn** — `runRecordedTurn` wraps `runAcpSession` (`src/acp/client.ts`), taping
   every ACP event to the transcript recorder + hub.
5. **Auto-finish** — `runAutoFinish`: clean-finish vs `autoPublishDirty` (push + open/update
   PR) vs a "connect a code host" message when no forge token.
6. **Teardown** — `runTeardown` (workspace cleanup, runtime shutdown, MCP apparatus teardown).

`followUpSession` re-checks `CONTINUABLE`, re-validates the parent's stored `projectSpec`
against the _current_ operator policy (a guardrail tightened after the parent started still
applies), attempts ACP `session/load` resume via the captured `acpSessionId` (stored on the
lineage root, resolved by `lineageIdOf`), shuttles agent-home state dirs (`.magi-home`,
`.magi-codex`) between worktrees (`SessionStateShuttle`), and reuses the parent's branch/PR
(`buildFollowUpPrompt` prepends the parent prompt + final answer as context).

### 4.5 The `projectSpec` trust boundary (`src/project/spec-validation.ts`)

`validateRepoSpec(value, policy)` re-parses **every** field defensively even though papai
already validated it:

- `repoUrl` must be `https:` and its host in `policy.allowedHosts` (`MAGI_ALLOWED_REPO_HOSTS`).
- `name`/`baseBranch` non-empty; `permissionPreset` ∈ {autonomous, cautious, readonly};
  `agent` ∈ `SPEC_AGENTS` and (if `MAGI_ALLOWED_AGENTS` set) in that allowlist.
- `resolveForge`: `apiBaseUrl` must be `https:` with host in `SAAS_API_HOSTS`
  (`api.github.com`/`gitlab.com`, always admitted) or `policy.allowedHosts`.
- `parseModel`: ≤200 chars, no control characters.
- `parseAdditionalEgress`: bare hosts only, deduped, ≤20.
- `resolveMcp`: ≤`MAX_MCP_UPSTREAMS = 8`; each `id` matches `MCP_ID_PATTERN`
  `/^[a-zA-Z0-9_.:/-]+$/` (ids are later CSV-joined so no commas/whitespace); `url` https with
  host pinned + in `policy.allowedHosts`; `allowedHosts` bare + must include `host`; optional
  `toolPolicy` via `resolveMcpToolPolicy` (uses `Object.hasOwn` to avoid a prototype-pollution
  gate bypass on `__proto__`/`constructor`); duplicate ids reject the whole spec.

`assertServeReady(policy)` (`main.ts`) **fails serve startup** if `MAGI_ALLOWED_REPO_HOSTS` is
empty/unset — the SSRF gate is fail-closed.

### 4.6 Git & forge (`src/workspace/`, `src/git/`, `src/forge/`)

- `GitWorkspaceManager` keeps a shared **bare mirror** per project at
  `<root>/cache/<project.name>/.git` (`ensureMirror`), then `prepare()` creates a **worktree**
  on `acp/<sessionId>`, or `prepareContinue()` checks out a specific branch (follow-up /
  PR-adoption). `isDirty()` gates push; `finish()` pushes; `cleanup()` removes the worktree.
- `src/git/git.ts`: HTTPS + token only (no SSH). `usernameFor(kind)` → `oauth2` (GitLab) /
  `x-access-token` (GitHub). `buildEnv` injects `GIT_ASKPASS=assets/git-askpass.sh`,
  `GIT_TERMINAL_PROMPT=0`, `MAGI_GIT_USERNAME`/`MAGI_GIT_TOKEN` — **the forge token is used by
  magi's git, never handed to the agent.**
- `Forge` interface: `createPullRequest`, `listPullRequests`, `getPullRequest(prNumber)`,
  `getPullRequestDiff(prNumber)`; `forgeFetch` uses `Authorization: Bearer <token>` for both.

### 4.7 Permission engine (`src/permission/`)

`decidePolicy` per `permissionPreset`: `readonly` → auto-deny all writes; `cautious` →
ask (parks the request, notifies papai `needs_permission`, waits for a `POST
…/permission`); `autonomous` → allow. The `PermissionEngine` (`engine.ts`) parks requests with
a TTL; papai's `answer_permission` tool resolves them by `toolCallId`.

### 4.8 Config / env (`README.md`, `deploy/`)

| Var                                     | Purpose                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `MAGI_RUNTIME`                          | `geofront` (real) or `stub` (dev/test)                                                       |
| `MAGI_PORT`                             | serve HTTP port                                                                              |
| `MAGI_API_TOKEN`                        | bearer required by every route except `/health`                                              |
| `MAGI_ALLOWED_REPO_HOSTS`               | SSRF allowlist (repo/forge/MCP hosts); **required, fail-closed**                             |
| `MAGI_ALLOWED_AGENTS`                   | optional agent allowlist                                                                     |
| `MAGI_PROJECT_DEFAULTS`                 | JSON `{ workspaceImage, agentEntrypoint, egressAllowlistDomains }` merged into every session |
| `MAGI_WORKSPACE_ROOT`                   | host root for worktrees                                                                      |
| `MAGI_DB`                               | SQLite session-store path                                                                    |
| `MAGI_NOTIFY_URL` / `MAGI_NOTIFY_TOKEN` | **outbound** milestone webhook → papai `/api/notify`                                         |
| `MAGI_TRANSCRIPT_DIR`                   | enables JSONL transcript persistence                                                         |
| `MAGI_TRANSCRIPT_BASE_URL`              | base URL for constructing transcript links                                                   |
| `MAGI_RUNTIME_READY_TIMEOUT_MS`         | socket-appear timeout for slow cold builds                                                   |
| `LOG_LEVEL`                             | pino level                                                                                   |

`deploy/`: `magi.service` (systemd, depends on `docker.service`, explicit `PATH=`, runs `bun
src/main.ts serve`), `magi.env.example`, `org.toml` (geofront **org layer** installed at
`~/.geofront/config/org.toml`, sets `[egress.policy.ceiling]`).

---

## 5. magi → geofront integration (the seam)

### 5.1 What magi renders and shells out

`GeofrontRuntime` (`src/runtime/geofront/geofront-runtime.ts`):

- `provision()` writes `geofront.toml` via `renderGeofrontToml`. magi emits **only** what
  geofront's closed (`deny_unknown_fields`) schema accepts: `workspace_image`,
  `runtime.agent{kind,entrypoint}`, and an `egress` allowlist. Geofront's schema has **no**
  mount/env-injection fields (documented at length in `magi/docs/geofront-limitations.md`) — so
  everything secret-shaped is handled by magi's own provisioning overlay, not geofront config.
  - **Plain mode**: no `project.provisioning` → render TOML against the base `workspaceImage`.
  - **Dockerfile mode**: `resolvePlan` → `planWithProviderEgress` (union provider hosts into
    egress) → `writeBuildContext` (Dockerfile overlay) → `stageSecrets` → git-exclude hardening
    (`.magi-build/`, `.magi-private/`, `.magi-codex/`, `.magi-home/`, `geofront.toml`).
- `launch()` spawns `geofront workspace up --acp <socketPath>` (plus `--mcp-mount
<mcpSocketPath>` when MCP is enabled), `waitForSocket`s, and on failure kills the child, runs
  `workspace down`, cleans artifacts, tears down the MCP apparatus — **no leaked Docker
  resources**. `CONTAINER_WORKSPACE = /home/dev/workspace` is the in-container path geofront
  bind-mounts the worktree to; that (not the host path) is the ACP `cwd`.
- Provisioning presets (`provisioning/presets.ts`): `claudePreset`, `codexPreset`,
  `opencodePreset`. `codex-config.ts::generateCodexConfigToml(baseUrl)` emits
  `~/.codex/config.toml` (`[model_providers.custom]`, `env_key="OPENAI_API_KEY"`,
  `wire_api="chat"`) because **codex reads its base URL from that file, not `OPENAI_BASE_URL`**.
  `opencode-config.ts::generateOpencodeConfig(baseUrl, model, mcpServers)`.
- Secret staging: `assets/magi-init.sh` installs staged secrets into the container at boot and
  **shreds** them after read, so credentials never persist in the image or linger post-launch.
- Orphan GC: `gc.ts::sweepOrphanWorkspaces` (concurrency 4) fires non-blockingly at serve
  startup (geofront runtime only).

### 5.2 Egress: ceiling ∩ allowlist

magi computes a **per-session allowlist** = project defaults' `egressAllowlistDomains` ∪ the
caller's `providerHost` ∪ agent-infra host (codex→`chatgpt.com`, opencode→`models.dev`) ∪ MCP
upstream hosts ∪ `additionalEgressDomains`. geofront's **org-layer ceiling**
(`[egress.policy.ceiling]` in `org.toml`) is separate. **Effective egress = allowlist ∩
ceiling** — the ceiling can only _remove_ hosts, never add. A custom `openai-compatible`
endpoint or an MCP host outside the ceiling is silently dropped; the operator must widen the
ceiling. (This is the #1 deployment footgun, per `deploy/org.toml` comments and
`magi/docs/deployment.md`.) The repo clone host is **not** in the sandbox egress — the agent
can't auth to the forge anyway.

### 5.3 The ACP conversation

magi speaks **ACP (JSON-RPC)** to the agent over the Unix socket that geofront's `--acp` relay
exposes (`src/acp/client.ts::runAcpSession`): `session/new` → prompt → stream of `update` /
`permission_request` events → `session/set_config_option` to apply the model (uniform across
claude/codex/opencode; `selectModelConfig` matches by value then display name, warns + falls
back on unknown, never hard-fails) → turn ends with a `StopReason`. Resume uses `session/load`
with the captured `acpSessionId`.

### 5.4 MCP credential-isolation broker (`src/mcp-broker/`)

The design goal: a sandboxed agent can _use_ a credential-bearing upstream MCP server without
the credential ever entering the agent sandbox or widening the agent's egress.

- Per configured upstream, `startMcpApparatus` launches a credential-holding **worker
  enclosure** (`worker/enclosure.ts`) — its **own** `geofront workspace up --acp <ctrlSocket>`
  process (a tiny `node:22-bookworm-slim` plan) with a `request`-sourced `MCP_UPSTREAM_TOKEN`
  secret staged like agent provider creds, and **kernel-enforced egress restricted to the
  upstream host only**.
- A single **mediator** (`startMediator`) accepts the agent's tunnel connections (over the
  `--mcp-mount` socket) and routes each by `serverId` (`makeServerRouter`) to the matching
  worker.
- Each entry's `toolPolicy` gates its handler via `makeGatedHandleConnection`/`gate.ts`: a
  request-side JSON-RPC peek on `tools/call` looks up `params.name` — `allow` forwards bytes
  unchanged, `deny` synthesizes a JSON-RPC error so the denied call **never reaches the
  credential-holding worker**. Batch arrays are rejected wholesale (fail-closed;
  MCP 2025-06-18 removed batching). `decideToolCall` uses `Object.hasOwn` to avoid a
  prototype-pollution bypass. Responses stay fully opaque — only requests are parsed. Every
  decision is pino-audited `{ sessionId, serverId, tool, decision }`, no payload.
- **Invariants**: INV-1 the upstream credential never enters the agent sandbox; INV-2 the
  agent gains no new egress (the worker's restricted egress lives in a separate enclosure).
  Teardown (`teardownMcpApparatus`) closes the mediator + best-effort shuts down every worker.
- **Cost**: each MCP-enabled session = **two** geofront enclosures (agent + worker), each with
  its own egress proxy. MCP-disabled sessions start no mediator/worker.

### 5.5 Milestone notifications (magi → papai)

`HttpNotifier.notify(milestone)` (`src/notify/notifier.ts`) POSTs `{ contextId, markdown }`
with `Authorization: Bearer <MAGI_NOTIFY_TOKEN>` to `MAGI_NOTIFY_URL`
(papai's `/api/notify`). `MilestoneKind`: `needs_permission | waiting_input | done | failed |
cancelled | answer` (+ unemitted `review_posted` vestige). Fire-and-forget — non-2xx and
fetch errors are logged as warnings, never thrown. On papai's side, `/api/notify` is its own
trust plane (bearer `NOTIFY_TOKEN`, timing-safe compare), delivering a proactive chat message
via `ChatRouter.sendMessage`; the `contextId` re-derives the originating thread so the
notification lands where the session was started.

---

## 6. geofront — the sandbox launcher (the isolation layer)

Root: `/Users/ki/Projects/experiments/geofront`. Rust workspace, edition 2024, version 0.3.0,
`unsafe_code = forbid` workspace-wide. Binary/product `geofront` (crate `crates/cli`; Debian
package `kontur-geofront`). An internal SKB Kontur tool.

### 6.1 Isolation philosophy (README §"Основные принципы", translated)

1. AI agents cannot be trusted by default.
2. If a vulnerability exists, the agent will try to exploit it.
3. If none exists, the agent will try to find one.
4. Agent access to secrets means those secrets are leaked.
5. Agent access to untrusted network addresses leads to prompt injection, and is not permitted.
6. The agent's working environment is, by default, assumed compromised.

Isolation is explicitly **best-effort**, aiming to shrink attack surface: no secrets,
deny-by-default network with an allowlist that can't be influenced from inside the workspace,
and filesystem access limited to explicitly required resources. **Out of scope** (stated
limitations): vulnerabilities in the isolation environment itself (cites CVE-2025-9074, a
Docker Desktop escape), prompt injection from _trusted_ sources, trade-secret leakage, active
user violation of the model, social engineering.

### 6.2 Crate/workspace map

| Crate (path)            | Package                   | Role                                                                                                                                                                          |
| ----------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/cli`            | `geofront`                | The binary: clap CLI, ratatui TUI, command handlers, OTLP metrics, tracing. Default member.                                                                                   |
| `crates/core`           | `geofront-core`           | Runtime-agnostic core: layered TOML config, `EffectiveConfig`, `AgentKind`, egress-policy IR/materialization, workspace lifecycle types, `RuntimeProvider` types, exit codes. |
| `crates/runtime-docker` | `geofront-runtime-docker` | The only `RuntimeProvider` today: Docker CLI wrapping, agent + egress-proxy container lifecycle, network reconcile, embedded proxy image assets.                              |
| `crates/acp-relay`      | `geofront-acp-relay`      | Transport-agnostic **byte** relay for `--acp` (stdio ↔ Unix socket, no ACP parsing).                                                                                          |
| `crates/policy`         | `geofront-policy`         | Scaffold (`PolicyDecision`) — placeholder for ADR-0011 policy packs.                                                                                                          |
| `crates/audit`          | `geofront-audit`          | Scaffold (`AuditEvent`) — placeholder for ADR-0009.                                                                                                                           |
| `crates/redaction`      | `geofront-redaction`      | Concrete: masks `token`/`password`/`secret`/`credential`/`api_key`/`authorization` values + URI userinfo before diagnostics/logs.                                             |
| `crates/leliel/*`       | `leliel-*`                | A **separate sub-product**: a remote host-tool-execution broker (axum TLS/WebSocket host + `leliel` CLI). Architecturally adjacent, not part of the sandbox path.             |

### 6.3 Isolation mechanism (Docker runtime, Linux-specific)

Layered, all requiring a **local Linux Docker Engine** (WSL works — it's a real Linux kernel):

**(a) Container hardening** (`crates/runtime-docker/src/agent.rs::create_agent_container`):
`--cap-drop ALL`, `--security-opt no-new-privileges`, non-root numeric `--user uid:gid`
resolved from the _host_ user's `id -u`/`id -g` (refuses uid/gid 0). Only the workspace dir,
per-`AgentKind` config dirs, optional git-persistence files, and an optional MCP broker socket
are bind-mounted. Runs on an **internal-only** Docker network with `--add-host`/`--network-alias`
pointing only at the proxy — the agent has no route to any other network.

**(b) Deny-by-default egress proxy** (`crates/runtime-docker/src/proxy/*`, assets in
`assets/egress-proxy/`): a separate container (3proxy 0.9.5 + a statically-linked dnsmasq).
`entrypoint.sh` renders a 3proxy ACL from mounted `domains.txt`/`cidrs.txt`/`ports.txt`:
explicit `allow` for allowlisted domains/CIDRs+ports, a `deny * * *.* <ports>` catch-all that
forces IP-literals down to the CIDR rule, and a final `deny * * * * *`. A local dnsmasq
resolves only allowlisted domains and **sinkholes everything else** to `198.18.0.254` /
`100::2` — so DNS itself is deny-by-default, not just the HTTP CONNECT layer. Optional
`upstream_proxy` routes only named domains through a corporate proxy (fail-closed). Optional
`network_attachment = host_network` (proxy container only, never the agent) is rejected — no
silent fallback — on remote/Docker Desktop/non-Linux/rootless.

**(c) Strict in-container egress** (`src/agent_runtime/strict_egress.sh`, applied by a
**privileged ephemeral sidecar** `docker run --rm --network container:<agent> --cap-add
NET_ADMIN`): flushes and sets `OUTPUT` policy to `DROP`; in the `raw` table drops DNS/DoT/mDNS/
LLMNR (53/853/5353/5355) to loopback _before_ conntrack (closes a loopback-resolver bypass);
in `filter` accepts only loopback (minus those ports), established/related, and TCP to the
proxy IP:port. Duplicated for `ip6tables`. Then runs a **self-test** that actively probes every
loopback resolver in `/etc/resolv.conf` (+ Docker's `127.0.0.11`) and **fails hard** if any
still answers — it verifies the lockdown rather than trusting the `iptables` calls. Requires
`iptables`/`ip6tables` in the workspace image. Toggle: `security.strict_isolation` /
`--isolation-strict <0|1>`.

**(d) Filesystem**: only the workspace dir (rw) + narrow per-`AgentKind` host config dirs
(`~/.codex`, `~/.claude`), optional git-persistence, optionally one broker socket. Nothing else.

**Why Linux/same-kernel only**: strict egress depends on Linux `netfilter`/`iptables` applied
inside the agent's own netns from a privileged sidecar sharing that netns, and Docker Linux
network-namespace semantics (`--network container:<name>`). No landlock/seccomp is used —
process/FS isolation is Docker's default namespaces + cgroups + capability dropping. Because a
bind-mounted socket (`--mcp-mount`) requires a shared kernel, the MCP broker path is native
Linux/CI only — not VM-backed Docker Desktop.

### 6.4 Agent ("enclosure") model

There's no literal `Enclosure` type; the analogue is the **agent container**
(`AgentContainerSpec` → `AgentContainerOutcome`). `AgentKind` (`crates/core/.../types.rs`):
`Codex | ClaudeCode | Other`. `AgentConfig { kind, entrypoint }`. Default entrypoints:
`Codex → ["codex"]`, `ClaudeCode → ["claude"]`, `Other → []` (must be explicit). Per-kind host
mounts: Codex mounts `~/.codex` (+ `CODEX_HOME`, `CODEX_DEFAULT_YOLO=1`); ClaudeCode mounts
`~/.claude` (+ `CLAUDE_CONFIG_DIR`); Other gets no agent-specific mount. Launch: the container
is `docker create`d asleep, then the agent starts via `docker exec` — `-it` for a normal
session, `-i` (piped, no TTY) for an ACP session — through the embedded `run_agent.sh` wrapper
(normalizes proxy env casing, sets git identity, `exec "$@"`). `AgentKind::Other` + `--acp` is
exactly how magi runs its credential-holding **`mcp-worker`** binary under the same
relay/egress machinery (test-asserted).

### 6.5 Egress config & the ceiling (`crates/core`)

`geofront.toml` `[egress]` tree: `driver = "proxy_container"`, `enforcement = "strict"`,
`[egress.proxy_container]` (`port`, `policy_delivery = "mount"`, `network_attachment`, `image`),
`[egress.policy.allowlist]` (`domains`, `cidrs`, `ports`) + `allowlist_files` +
`[egress.policy.ceiling]`. Requested policy = **bounded union** across layers; the ceiling is a
governance guardrail that can **only** originate from `BuiltInDefaults`/`OrganizationProfile`
(`is_trusted_ceiling_layer`) — set from project/user/CLI → config validation fails. Effective =
`requested ∩ ceiling`; requested entries outside the ceiling fail closed. Materialization
(`egress_policy/{collect,hash,materialize,bundle_writer}.rs`) writes a hashed bundle under
`~/.geofront/cache/egress-policy/<hash>/`, bind-mounted into the proxy at
`/etc/egress-proxy/allowlist` (path enforced by the `ai.geofront.egress.allowlist_dir` image
label). The proxy image carries a labeled **contract** (`ai.geofront.egress.contract=v1`, +
feature labels for `bind_address`/`upstream_proxy`/`agent_ingress`); missing/mismatched labels
fail closed unless `allow_unknown_contract = true`.

### 6.6 The `--acp` relay (`crates/acp-relay`)

`serve_acp_bridge(socket_path, child)`: a **verbatim byte pump** (no ACP/JSON-RPC parsing)
between a spawned child's piped stdio and exactly one client over a Unix socket. Invoked via
`geofront workspace up --acp <socket>` (global flag on `Cli`). Single client, single shot, no
reconnect. It drains agent→client to completion **before** reaping the child (does not race
`child.wait()` against the pump) so the agent's last buffered ACP reply is always delivered.
Removes stale sockets before bind; `chmod 0600` (with a documented brief TOC-TOU window —
callers should place the socket in a `0700` dir). No inbound Docker ports — the socket lives on
the host side of `docker exec`.

### 6.7 CLI surface

```
geofront [global-options] <command>
  version | workspace {up|down|status} | config {validate|explain} | diagnostics bundle
```

Bare `geofront` ≡ `workspace up`. Passthrough agent args via `-- <args>`. Global flags:
`--json`, `-v/-vv`, `--org-config/--project-config/--user-config <path>`, `--proxy-port`,
`--isolation-strict <0|1>`, `--upstream-proxy-allow-host-gateway <0|1>`, **`--acp <socket>`**,
**`--mcp-mount <socket>`** (bind-mounts a host `0600` socket, created by magi, to
`/run/magi/mcp.sock` inside the container), trailing `session_args`.

`workspace up` pipeline: preflight (config, workspace safety, provider availability) → network
reconcile → build/reuse embedded proxy image → materialize + mount egress policy bundle →
reconcile proxy container + wait healthy → bootstrap workspace → run agent (`docker exec`) →
cleanup owned runtime on exit → exit with the agent's code.

### 6.8 Config layering (`docs/user/configuration.md`, ADR-0005)

TOML only, `configVersion = "1.0"` mandatory, strict schema (unknown fields error), ~1 MiB cap.
Five layers lowest→highest: `BuiltInDefaults` → `OrganizationProfile` (**not loaded by
default** — only via `--org-config`; this is where magi's `org.toml` ceiling lives) →
`ProjectProfile` (`./geofront.toml`) → `UserProfile` (`~/.geofront/config/user.toml`) →
`CliOverride`. Most lists whole-replace at higher layers; `egress.policy.allowlist` is the sole
`bounded_union` exception.

### 6.9 Secret handling

geofront has **no built-in secret manifest/staging/shredding** — consistent with principle #4
it simply _never_ mounts secret material into the agent by default. The one opt-in is
`git.share_host_credentials` (default false). The `magi-init` staging/shredding described in §5.1
is **magi's** mechanism, not geofront's. geofront's contract with magi is limited to the
`--mcp-mount` (`/run/magi/mcp.sock`) and `--acp <socket>` flags; the credential-holding
`mcp-worker` is itself run as an isolated `AgentKind::Other` "agent" so even the broker gets
network-denied-by-default treatment. Credential governance beyond this is aspirational
(ADR-0012, "Proposed"); `crates/redaction` is the one concrete piece.

---

## 7. End-to-end walkthroughs

### 7.1 Start a session ("work on this in repo X")

1. LLM calls `plugin_acp__start_session { project, prompt, prNumber? }`.
2. papai resolves `agent-provider` secrets + `forge` + `mcp` for the effective identity
   (guardrails + group `coding_identity`); refuses `not_configured` if the provider key (or, for
   self-hosted/PR, the forge token) is missing.
3. papai builds `projectSpec` + `secrets` + `mcpTokens`, injects thread `storageContextId` as
   `contextId`, and `POST /sessions` to magi (bearer `magi_token`).
4. magi `validateRepoSpec` (SSRF + agent allowlist + MCP caps), rate-limits on `contextId`,
   creates the session (`queued`), returns `202 { id, status }`. papai records a local
   `SessionRecord` in `plugin_kv`.
5. magi prepares the worktree (new `acp/<id>` branch, or PR head if `prNumber`), renders
   `geofront.toml` (egress = derived allowlist ∩ ceiling), stages secrets, and — if MCP —
   launches worker enclosure(s) + mediator.
6. magi `geofront workspace up --acp <sock> [--mcp-mount <sock>]`; geofront builds the sandbox
   (hardened container + deny-by-default proxy + strict iptables) and starts the agent.
7. magi speaks ACP: `session/new` → prompt → applies model → streams `update`/`permission`
   events into the transcript recorder + SSE hub.
8. On a `cautious` permission request, magi parks it, notifies papai `needs_permission` →
   papai delivers a proactive chat message → user replies → LLM calls `answer_permission` →
   papai `POST …/permission` → magi resolves it → agent continues.
9. Turn ends (`end_turn` → `waiting_input`). If dirty and a forge token is present, auto-finish
   pushes + opens a PR; papai gets a `done`/`waiting_input` milestone and can surface the PR +
   `transcriptUrl`.

### 7.2 Watch the transcript

papai returns a `transcriptUrl` on papai's public origin. The browser hits papai's public
token-gated `/t/<token>` viewer, which **bearer-proxies** paged history + SSE to magi's
`/sessions/:id/transcript` and `/sessions/:id/stream`. Read-only — approvals stay in chat.
(Treat the URL as a bearer secret: the log is raw and unredacted.)

### 7.3 Continue a session

`continue_session { sessionId? | prNumber?, prompt }` → `POST /sessions/:id/follow-up`. magi
requires the parent to be `CONTINUABLE`, re-validates its stored `projectSpec` against current
policy, resumes via ACP `session/load`, reuses the parent branch/PR, and pushes back to the
same branch (updating the existing PR).

### 7.4 Use an MCP tool from inside the sandbox

The agent's ACP config declares an `mcp-tunnel` binary that dials `/run/magi/mcp.sock`. magi's
mediator routes by `serverId` to the credential-holding worker enclosure (egress = upstream
host only), which injects the upstream credential and POSTs to the upstream. Per-tool policy
gates `tools/call` at the mediator — a denied tool's request never reaches the worker, so the
credential is never used for it. The agent never sees the credential and gains no new egress.

---

## 8. Trust boundaries & invariants (summary)

- **papai never sends the forge token into the sandbox.** The forge token goes to `finish`/
  push (magi's git askpass) and PR creation — magi-side only. The agent authenticates to
  nothing on the forge.
- **magi re-validates everything papai sends** (`validateRepoSpec`) — https-only, host in
  `MAGI_ALLOWED_REPO_HOSTS`, agent in `MAGI_ALLOWED_AGENTS`, MCP caps, prototype-pollution-safe
  tool policy. The SSRF allowlist is fail-closed (empty → serve won't start).
- **The egress ceiling can only remove hosts.** A user's `additionalEgressDomains` or a custom
  provider/MCP host outside the org ceiling is silently dropped — operators widen the ceiling.
- **MCP INV-1/INV-2**: the upstream credential never enters the agent sandbox (separate worker
  enclosure), and the agent gains no new egress.
- **geofront assumes the agent is compromised**: cap-drop ALL, non-root, deny-by-default DNS +
  proxy, strict iptables with an active self-test, no secrets mounted by default.
- **Every service boundary is bearer-authed**: papai→magi (`magi_token`), magi→papai
  (`MAGI_NOTIFY_TOKEN`), papai transcript proxy→magi (`magi_token`), papai `/api/notify`
  (`NOTIFY_TOKEN`), papai `/t/<token>` and magi `/sessions/:id/*` (opaque/bearer possession).

---

## 9. Key file map (for navigation)

**papai** — `plugins/acp/{client,session-tools,tools,continue-tool,history,session-records,index}.ts`;
`src/coding-credentials/{resolve-agent-secrets,resolve-mcp-servers,mcp-catalog,mcp-selections,
guardrails,forge*}.ts`; `src/mcp-server/{token}.ts`; `src/debug/{transcript-viewer,server}.ts`;
`src/llm-orchestrator-tools.ts` (`whoMayUse` filter); settings routes under
`src/debug/settings/`.

**magi** — `src/server/router.ts`; `src/session/{state,manager,lifecycle,store,hub}.ts`;
`src/project/spec-validation.ts`; `src/permission/{engine,policy}.ts`;
`src/workspace/git-workspace.ts`; `src/git/git.ts`; `src/forge/{github,gitlab}.ts`;
`src/runtime/geofront/{geofront-runtime,geofront-toml,mcp-apparatus}.ts` +
`provisioning/{presets,codex-config,opencode-config,secret-stager}.ts` + `assets/magi-init.sh`;
`src/mcp-broker/{mediator,gate,server-router,worker/enclosure}.ts`; `src/notify/notifier.ts`;
`deploy/{magi.service,org.toml,magi.env.example}`; `docs/{deployment,geofront-limitations}.md`.

**geofront** — `crates/cli/src/cli/root.rs` (flags); `crates/core/src/config/**` (layering +
ceiling); `crates/core/src/runtime/egress_policy/**`; `crates/runtime-docker/src/{agent,
agent_runtime}.rs` + `agent_runtime/{run_agent.sh,strict_egress.sh}` + `proxy/**` +
`assets/egress-proxy/{Dockerfile,entrypoint.sh,proxy.cfg}`; `crates/acp-relay/src/{lib,pump}.rs`;
`docs/adr/ADR-00{04,05,11,12,13}.md`, `docs/specs/SPEC-000{0,3,4}.md`, `docs/CLI.md`.

---

_Compiled 2026-07-09 from source across all three repositories. Where this document and
`coding-sessions.md` disagree, this document reflects the current code (see the drift notes in
§1, §3, §4.2). If magi's API or geofront's flags change, re-verify §4.2 and §6.7 against
`magi/src/server/router.ts` and `geofront/crates/cli/src/cli/root.rs`._

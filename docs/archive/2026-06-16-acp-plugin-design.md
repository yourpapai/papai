<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ACP Agent Sessions — Design Spec

- **Date:** 2026-06-16
- **Status:** Approved (design); ready for implementation planning
- **Scope:** A papai capability that lets a chat user drive sandboxed AI coding-agent sessions over the Agent Client Protocol (ACP) — configure agents/projects, start sessions (git fetch/checkout/worktree/branch), track progress in natural language, finish (commit/push/PR), and review open PRs.

This spec spans **three deliverables across three repos**: a thin papai plugin + one papai-core endpoint (`papai`), a new TypeScript control service (`papai-acp-control`, new repo/service), and ACP support added to the existing Rust sandbox tool (`acp-agent`).

---

## 1. Problem & goals

A user sends natural-language messages to papai ("start a session on repo X to do Y", "what's running?", "finish and open a PR", "review PR #123"). papai should translate those into **sandboxed coding-agent work**: an AI agent runs in an isolated container, edits a checked-out worktree, and the user supervises it from chat. The privileged operations (ACP client, git, forge, session state, permissions, secrets) must live in a trusted control plane; the untrusted, code-executing agent must be sandboxed and never hold forge/push secrets.

### Required behaviours (from the request)

1. **Configure agents/projects.**
2. **Start session** — fetch/checkout, per-session worktree + branch.
3. **Progress** — query current sessions in natural language (active / new / review / waiting-for-response).
4. **Record progress + metadata telemetry.**
5. **Finish session** — commit/push/create PR/output summary + review link.
6. **Review open PR** — fetch/checkout, start a review session, create review comments.

### Non-goals (v1)

- Live token-by-token streaming of agent output into chat (background + milestone model instead).
- Per-user forge identities (shared bot service account in v1).
- Remote/k8s sandbox fleets (single-host acp-agent in v1; topology designed to evolve).
- Dynamic mid-session egress-allowlist broadening (fixed per session at start).

---

## 2. Research findings that shaped the design

These were verified against the codebases before designing (see decision log, §11).

### papai plugin sandbox cannot host ACP

The plugin runtime (`src/plugins/`) exposes exactly one outbound primitive — `providerRuntime.httpFetch()` (stateless HTTPS to allowlisted hosts). Verified absent: subprocess spawning (`child_process`/`Bun.spawn`), persistent stdio/WebSocket for plugins, local git, and a working `stdio` MCP transport (schema-reserved, hard-throws at runtime). ACP requires spawning an agent subprocess and holding a JSON-RPC-over-stdio channel with agent→client callbacks. **Therefore the ACP runtime cannot live inside the plugin sandbox** — it lives in an external service; the plugin is a thin HTTP client.

### papai cannot proactively message users from a plugin

Core _can_ send proactively — `ChatProvider.sendMessage(platformInstanceId, target, markdown)`, driven by the in-process scheduler, resolving the instance from the `context_settings` table (this is how deferred prompts and recurring tasks deliver). But **no plugin runtime context exposes any send/notify** (tool, command-proactive, or scheduled-job), and plugins cannot register HTTP routes. The only inbound send route today (`POST /settings/api/admin/announce`) broadcasts to all users. **Therefore the "background + milestone notifications" model requires one small papai-core addition: a targeted notify endpoint.**

### acp-agent is a production sandbox, but has no external agent I/O

acp-agent (Rust CLI) already does zero-trust Docker sandboxing: workspace container + egress-proxy container with a domain/CIDR allowlist enforced by in-namespace `iptables` (deny-by-default), `--cap-drop ALL`, `no-new-privileges`, non-root, host-cwd bind-mounted to `/home/dev/workspace`. Agent presets `codex`/`claude_code`/`other` (custom `entrypoint`), spawned via `docker exec`. **Gap:** the agent runs under `docker exec -it` with inherited terminal stdio — there is no way for an external ACP client to attach, no server/API, no stdin injection from outside, no sessions, no ACP awareness, no git (workspace = host cwd), no resource limits/timeouts. The clean seam to add ACP is the `RuntimeProvider::run_agent_session` boundary.

### agent-sniff (evaluated, not used)

agent-sniff (a Bun ACP bridge) was evaluated as the ACP client/transport. Because acp-agent becomes the sandbox and exposes a raw ACP stdio stream, the control service builds **directly on `@agentclientprotocol/sdk`** instead. agent-sniff is retained only as a _reference_ for chunk taxonomy and the DebugRecorder telemetry pattern — no code dependency.

---

## 3. Architecture

Three tiers; the plugin is thin, the control service owns all operational work, acp-agent is the sandboxed ACP-exposing agent runtime.

```
papai bot ──httpFetch──► CONTROL SERVICE (host, trusted; TS/Bun — new)
papai core ◄── /api/notify ── │  ACP client (@agentclientprotocol/sdk)
                              │  session state machine + SQLite
                              │  permission engine · notifier
                              │  WorkspaceManager: git clone-cache + worktree + branch (host fs)
                              │  Forge (GitHub + GitLab)  ·  holds ALL secrets
                              │      │ per session: prepares worktree dir, writes acp-agent.toml,
                              │      ▼ spawns `acp-agent workspace up --acp <sock>` (cwd = worktree)
                              │   ACP client connects ◄── unix socket ──┐
                              ▼                                          │
                        ACP-AGENT (Rust CLI + NEW acp-relay) ────────────┘
                              ▼ docker exec (piped, no TTY)
                        AGENT SANDBOX (acp-agent-managed Docker)
                          claude-code-acp (kind="other")  ·  egress allowlist + iptables
                          workspace bind-mount  ·  LLM creds via mounted config  ·  NO forge token
```

### Trust & secrets boundaries

- **plugin ↔ control:** bearer token over `httpFetch`; the control base URL is admin-scoped so a LAN/HTTP control service is allowed by `providerAllowedHostsFromConfig`.
- **control ↔ acp-agent:** local Unix socket on the trusted host (filesystem permissions); add a token only if acp-agent is later placed remotely.
- **control → papai:** notify token to `POST /api/notify`.
- **Secrets:** forge token + git push creds + LLM key live **only** on the control host. The LLM key reaches the sandbox via acp-agent's config-dir mount; **the forge token never enters the sandbox.** Git commit/push and all forge calls run host-side on the worktree the agent edited through the bind-mount.

### Why this topology

- Untrusted code execution is isolated in acp-agent's hardened container; the trusted control plane holds secrets and performs privileged git/forge actions.
- acp-agent's raw-ACP-stdio relay means `session/request_permission`, `fs/*`, `terminal/*` all work natively over ACP (no broken HTTP permission path).
- The agent-launch boundary is an interface, so single-host docker today can evolve to remote/k8s sandboxes later without reworking the control logic.

---

## 4. acp-agent changes (Rust)

Net-new work, all at/under the `RuntimeProvider::run_agent_session` seam; tiers above it (config, plan, network, sandbox lifecycle) need zero changes.

1. **Piped exec** — a non-TTY `docker exec` variant that captures the agent's stdin/stdout (today's path uses `-it` with inherited terminal).
2. **Host-side ACP relay** — a Unix-socket (or TCP) listener that bridges raw bytes ↔ the agent's piped stdio. **Raw ndJSON passthrough**, _not_ re-framed into leliel's Postcard protocol, so an external ACP client speaks ACP straight through. The relay runs on the host; the container needs **no inbound exposure** (sandbox stays closed). The existing `leliel-host` process-streaming broker is the reference pattern.
3. **`SessionMode::AcpBridge`** (or equivalent) + a CLI mode `acp-agent workspace up --acp <socket>` selecting this path instead of interactive/skipped.
4. _(Optional, later)_ per-container CPU/memory limits and a session timeout (acp-agent sets none today; control-side timeouts cover v1).

A new crate (e.g. `crates/acp-relay`) or an extension of `crates/leliel/host` hosts the relay; `crates/runtime-docker` gains the piped-exec method; `crates/cli` wires the new mode.

---

## 5. Control service (TypeScript / Bun — new)

The bulk of the net-new work. Modules:

### 5.1 Session state machine

States: `queued → preparing → running ⇄ {waiting_permission, waiting_input} → finishing → done`; plus `failed`, `cancelled`. Review sessions use a `review` running-variant → `done`.

- **`preparing`** = clone-cache fetch + worktree/branch + `acp-agent workspace up`.
- **Milestone-emitting transitions** (→ `/api/notify`): `plan_ready` (first plan chunk), `waiting_permission`, `waiting_input` (turn ended; agent asks or idles), `failed`/`blocked`, `done` (with PR URL when finished), `review_posted`.
- **NL filter map:** "active" → running/preparing · "waiting" → waiting_permission + waiting_input · "review" → review · "new" → queued · "done" → done/failed/cancelled.

### 5.2 Permission engine

- **Policy presets** per project/agent: `autonomous` (auto-allow fs/terminal _inside the worktree_; ask on out-of-worktree/destructive ops), `cautious` (ask on any write/command), `readonly` (deny writes). **push/PR are never agent actions** — only the control plane performs them, gated behind explicit `acp_finish_session`.
- **Flow:** agent `session/request_permission` (over ACP) → engine evaluates policy → auto-allow/deny responds immediately; otherwise **park the ACP response promise**, persist a pending-permission record, set `waiting_permission`, emit a milestone. The user answers via `acp_answer_permission(allow_once | allow_always | deny)`, which resolves the parked promise; `allow_always` updates the session policy. An unanswered request hits a **TTL → auto-deny** + milestone.
- **Egress** is acp-agent's hard allowlist (deny-by-default); out-of-allowlist attempts surface as agent tool errors. _Known limitation:_ the allowlist is fixed at `workspace up`; broadening mid-session requires a new session (or a later acp-agent enhancement).

### 5.3 WorkspaceManager (git, host-side)

- Per project: a cached bare clone under a managed root, fetched on session start.
- Per session: `git worktree add` off the configured **base branch**, new branch `acp/<shortId>-<slug>`; that worktree dir is the cwd acp-agent bind-mounts into the sandbox.
- **Finish:** control-side `git add -A && git commit` (author = bot account) → `git push` → Forge PR.
- **Cleanup:** on done/cancel/timeout → `acp-agent workspace down` + `git worktree remove`; retain the worktree on failure for inspection (configurable).
- **Review:** `git worktree add` detached at the PR head ref.

### 5.4 acp-agent driver (per session)

- Templates a `acp-agent.toml` (project workspace image; `agent.kind="other"`, `entrypoint=["claude-code-acp", …]`; egress allowlist = project hosts + LLM host + package registries) and runs `acp-agent workspace up --acp <unix-sock>` with `cwd = worktree`.
- Connects the ACP SDK client to the socket once acp-agent signals ready (handshake: acp-agent announces socket-ready / control polls the socket).
- **LLM creds** delivered into the sandbox via acp-agent's config-dir mount (a generated service-account config dir); **forge token never provided.**
- Tracks the acp-agent child process + container; enforces per-turn / per-session **timeouts**; bounds concurrency with `p-limit`. **One acp-agent process per session** (acp-agent is one-shot by design; the control service is the multiplexer).

### 5.5 Forge layer

- `Forge` interface: `createPR`, `listPRs`, `getPR`, `getPRDiff`, `checkoutRef`, `createReviewComments`, `createReview`.
- **GitHub** adapter (Octokit) and **GitLab** adapter (gitbeaker). Project config carries forge type + repo identifiers; creds = the **shared bot account** (admin-scoped control config).
- **Review flow:** `getPR` + diff → worktree at PR head → acp-agent review session (agent prompted to review the diff, emitting structured findings `{ file, line, severity, comment }`) → control posts inline review comments + a summary review via the forge API.

### 5.6 Telemetry

- Control-owned **SQLite** is the source of truth: `sessions` (id, project, agent, contextId, status, branch, worktree, pr_url, base, timestamps), `milestones`, `permission_decisions`, `tool_calls` (name, arg-digest, status, duration), per-turn token/usage rollups, plan snapshots.
- Optional **JSONL replay** of the raw ACP chunk stream per session (admin flag, off by default) for deep debugging — modelled on agent-sniff's DebugRecorder.
- Natural-language queries read SQLite (no content leakage of repo internals beyond what the user already controls).

### 5.7 Control REST API (the plugin contract)

Bearer auth on all routes.

| Method | Path                       | Purpose                                                                  |
| ------ | -------------------------- | ------------------------------------------------------------------------ |
| POST   | `/sessions`                | start a session `{ project, agent?, branch?, base?, prompt, contextId }` |
| GET    | `/sessions?filter=`        | list sessions (filter ∈ active/new/waiting/review/done)                  |
| GET    | `/sessions/:id`            | session status + metadata                                                |
| POST   | `/sessions/:id/prompt`     | continue a session with a follow-up prompt                               |
| POST   | `/sessions/:id/permission` | answer a parked permission `{ decision }`                                |
| POST   | `/sessions/:id/finish`     | `{ action: commit \| push \| pr, title?, body? }`                        |
| POST   | `/sessions/:id/cancel`     | cancel + cleanup                                                         |
| POST   | `/reviews`                 | start a PR review `{ project, prNumber }`                                |
| GET    | `/projects`                | list configured projects                                                 |
| GET    | `/agents`                  | list configured agents                                                   |

Milestones flow out via papai's `/api/notify` (no SSE-to-plugin required in v1).

---

## 6. papai changes

### 6.1 `acp` plugin (`plugins/acp/`, thin)

- **Permissions:** `http`, `commands`, `storage`.
- **Admin config:** control base URL (declared in `providerAllowedHostsFromConfig` so a LAN/HTTP control service is reachable) + control bearer token (`sensitive`).
- **Tools (the NL surface):** `acp_start_session`, `acp_list_sessions`, `acp_session_status`, `acp_send`, `acp_answer_permission`, `acp_finish_session`, `acp_review_pr`, `acp_cancel_session`, `acp_list_projects`, `acp_list_agents`. Each validates input with Zod and calls the control REST API via `providerRuntime.httpFetch()`.
- **Prompt fragment:** teaches the NL→tool mapping and session vocabulary ("what's running?", "finish and open a PR", "review PR #123"), within the 2,000-char/fragment budget.
- **`/acp` (DM) command:** returns a status/settings link.
- **`plugin_kv`** (per context): maps `sessionId ↔ storageContextId` so list/status/answers are scoped to the originating chat context.

### 6.2 Core notify endpoint (the one core change)

- **`POST /api/notify { contextId, markdown, threadId? }`**, guarded by a **notify token** (new `system_config` key), reusing the deferred-prompt delivery path (`src/chat/delivery-routing.ts` → `ChatRouter.sendMessage`).
- Routed **before** the `DEBUG_SERVER`/`DEBUG_TOKEN` gates as its own trust plane (authorization = the notify token, independent of `DEBUG_SERVER`).
- The control service's Notifier calls it on each milestone using the session's stored `contextId`.

---

## 7. End-to-end flows

1. **Configure** — admin defines projects (repo URL, base branch, default agent, workspace image, egress allowlist, forge type + repo IDs) and agents (entrypoint/image preset) in the control service; forge/bot creds set admin-side on the control plane. Users see them read-only via `acp_list_projects` / `acp_list_agents`.
2. **Start** — `acp_start_session` → control: fetch (cached bare clone) → worktree+branch on host → `acp-agent workspace up --acp` (worktree bind-mounted) → ACP `initialize`/`session/new(cwd=/home/dev/workspace)`/`session/prompt`. Returns `sessionId` immediately; the turn runs in the background.
3. **Progress** — `acp_list_sessions(filter)` / `acp_session_status` query the SQLite state machine; milestones push proactively via `/api/notify`.
4. **Finish** — `acp_finish_session(action)` → host-side commit/push → Forge PR → returns title + summary + review URL; `done` milestone carries the link.
5. **Review** — `acp_review_pr(project, prNumber)` → fetch + checkout PR head into a review worktree → acp-agent review session → agent emits findings → control posts inline review comments + summary.

---

## 8. Error handling

- **acp-agent/container start fails** → `failed` + milestone (reason) + worktree cleanup.
- **Agent crash / non-zero exit** → `failed`; partial work retained on the branch (unpushed); user may inspect/retry.
- **ACP socket drop** → `interrupted`; attempt graceful `acp-agent workspace down`.
- **Forge failure on finish** → stay `finishing`, error milestone, retryable (branch already pushed ⇒ idempotent PR create).
- **Egress denial** → surfaced as an agent tool error; non-fatal; may become a permission ask.
- **Timeout** (per-turn / per-session) → cancel + cleanup + milestone.
- **Notify failure** → retry with backoff; logged; never crashes the session.
- **Permission never answered** → TTL → auto-deny + milestone.

---

## 9. Testing strategy

- **Control unit:** state-machine transitions, permission-policy decisions, branch naming, forge adapters (mocked HTTP), notify payloads.
- **Control integration:** a stub ACP agent (a fake agent speaking ACP over a socket) + a stub acp-agent driver; exercise start → prompt → permission → finish.
- **acp-agent (Rust):** unit tests for piped exec + relay byte-bridging; an e2e with a tiny ACP echo agent.
- **papai plugin:** tool-schema validation, mocked `httpFetch`, kv mapping, prompt-fragment budget; DI-first per repo conventions (`tests/CLAUDE.md`).
- **Optional gated e2e:** real acp-agent + claude-code-acp on a scratch repo → PR on a test forge.

---

## 10. Implementation decomposition (for writing-plans)

Independent plans, buildable in this order; the agent-launch boundary is an interface so tiers integrate against stubs.

1. **acp-agent ACP support** (Rust): piped exec + host ACP relay + `AcpBridge` mode + tests. Deliverable: `acp-agent workspace up --acp <sock>` exposes a raw ACP stream from a sandboxed `claude-code-acp`.
2. **Control service core** (TS): ACP client on the SDK + session state machine + SQLite + acp-agent driver, validated against a stub agent, then against deliverable #1.
3. **Control service WorkspaceManager + permission engine** (TS): git clone-cache/worktree/branch/finish + policy/escalation.
4. **Control service Forge layer** (TS): GitHub + GitLab adapters + review flow.
5. **Control REST API + Notifier** (TS): the plugin contract + milestone delivery.
6. **papai core notify endpoint** + delivery-path reuse + token.
7. **papai `acp` plugin**: tools, command, prompt fragment, config, kv.
8. **End-to-end wiring + optional gated e2e.**

---

## 11. Decision log

| #   | Decision                               | Choice                                                                                 |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Where the privileged ACP runtime lives | Sidecar service + thin plugin (not in the plugin sandbox; not papai core)              |
| 2   | Session interaction model              | Background + milestone notifications                                                   |
| 3   | Mid-turn permission handling           | Policy presets + chat escalation; push/PR always gated                                 |
| 4   | Agent support                          | Generic launcher + presets (admin-defined)                                             |
| 5   | Forge                                  | GitHub + GitLab (behind one `Forge` interface)                                         |
| 6   | Credentials/identity                   | Shared bot service account; secrets on control plane only                              |
| 7   | Integration topology                   | Control plane + sandbox that natively exposes ACP (Approach A), realised via acp-agent |
| 8   | Sandbox runtime                        | acp-agent (Rust, Docker, egress-allowlist) + net-new ACP relay                         |
| 9   | Control-side ACP client                | Build directly on `@agentclientprotocol/sdk`; agent-sniff dropped (reference only)     |

## 12. Open limitations (accepted for v1)

- Egress allowlist is fixed per session at `workspace up`; broadening requires a new session.
- Single-host acp-agent (no remote/k8s fleet yet); topology designed to evolve (orchestrator tier).
- acp-agent sets no per-container CPU/memory limits or session timeout; control-side timeouts cover v1.
- Shared bot identity ⇒ no per-user forge attribution.
- No live streaming of agent output into chat (by design).

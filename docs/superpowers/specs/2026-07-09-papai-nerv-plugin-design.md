<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: `plugins/nerv/` — the papai → nerv plugin

**Status:** Approved design (pre-implementation).
**Date:** 2026-07-09.
**Companion docs:** `docs/architecture/coding-sessions.md` (the acp template this copy-adapts),
`docs/architecture/coding-stack-overview.md` (papai → magi → geofront), nerv's own
`../nerv/docs/superpowers/specs/2026-07-09-supervisor-worker-foundation-design.md`.

---

## 1. Summary

nerv is the stateful **supervisor tier** of the coding stack — it owns long-running coding-task
state (watch a GitLab MR until CI is green, ingest review comments, iterate, crash-resume,
multi-repo fan-out) and drives magi over HTTP. papai has **zero** references to nerv today: there
is no path for a chat user's "supervise this MR" to reach nerv's `POST /tasks`.

papai already has a working template for exactly this shape: `plugins/acp/`, a thin first-party
plugin that is a stateless HTTP client of magi. **This plugin is that pattern re-pointed at nerv.**

```
papai ──HTTP──▶ nerv ──HTTP──▶ magi ──▶ geofront
(chat)          (state)         (exec)    (sandbox)
      ◀── /api/notify ── nerv → papai for ALL chat delivery
```

The plugin is the **only** new subsystem. papai's inbound path needs no changes: nerv reuses
papai's existing `/api/notify` endpoint with papai's existing `NOTIFY_TOKEN`, and per nerv's
foundation design `MAGI_NOTIFY_URL` points at **nerv**, not papai — so papai only ever hears from
nerv. The single core-side edit outside `plugins/nerv/` is adding nerv's tool names to the
existing `whoMayUse` gated set (§8).

### 1.1 Decisions locked during brainstorming

| #   | Decision                                             | Choice                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Where `repos[].projectPath` comes from               | **Reuse papai's existing coding-repo catalogue** (`codingRepos`), derive `projectPath` from the entry's `repoUrl`. Requires the `coding.secrets` permission (solely for the repo facade).                                                                   |
| D2  | How follow-up/steer/cancel resolve their target task | **One task per thread, auto-resolved** from a local record keyed by the thread's `storageContextId` (leverages nerv's `contextId`↔task 1:1 correlation). The LLM need not pass a taskId.                                                                    |
| D3  | Spec scope                                           | **Full parity**: MVP (create/status/events) + operator gating + `list_coding_tasks` + cost surfacing + `targetBranch`/`costBudgetUsd`/`kind` args.                                                                                                          |
| D4  | Plugin `storageScope`                                | **`group`** (mirror acp), not per-thread — so `list_coding_tasks` is visible across a group's sibling threads while the runtime still receives the raw thread-scoped id for auto-resolve and the contextId round-trip.                                      |
| D5  | Tool names                                           | `create_coding_task` / `coding_task_status` / `list_coding_tasks` / `followup_coding_task` / `steer_coding_task` / `cancel_coding_task` — disambiguated from papai's task-**tracker** tools (`get_task`/`update_task`) and from acp's "session" vocabulary. |

---

## 2. Non-obvious facts this design relies on (verified against both codebases)

These were confirmed by reading papai and nerv source; they are load-bearing and easy to get
wrong from the brief alone.

1. **Inbound to papai is already built.** `src/debug/notify-route.ts` accepts
   `{ contextId, contextType?, threadId?, markdown }` with a bearer `NOTIFY_TOKEN`
   (`src/notify-token.ts`, timing-safe compare). `buildNotifyTarget` decodes a thread-scoped
   `storageContextId` back to platform + channel + thread via `parseScopedContextId`
   (`src/chat/scoped-context.ts`). nerv's `PapaiNotifier` posts exactly this shape. **No papai
   core change is needed for delivery.**
2. **magi notifies nerv, not papai.** nerv's foundation design repoints `MAGI_NOTIFY_URL` to nerv;
   nerv correlates magi milestones back to a task and (re-)notifies papai. papai's only inbound
   source for supervised tasks is nerv.
3. **nerv correlates by `Task.findOne({'contextRef.contextId': contextId})`** (`../nerv/src/http/routes/notify.ts`).
   So `contextId` ↔ task is effectively **1:1 per thread**. This is the basis for D2's
   one-task-per-thread model and diverges from acp's many-sessions-per-chat model.
4. **`repos:[{projectPath}]` is a GitLab project path, not a `repoUrl`.** papai's catalogue stores
   `repoUrl`; the plugin derives `projectPath` from it (§5).
5. **nerv has no list/fleet endpoint.** Only `POST /tasks`, `GET /tasks/:id`,
   `POST /tasks/:id/events` (`../nerv/src/http/routes/tasks.ts`). `list_coding_tasks` therefore
   reads local records and enriches via `GET /tasks/:id`.
6. **The plugin needs no user secrets.** nerv holds the forge tokens (`FORGE_TOKEN`,
   `MAGI_FORGE_TOKEN`) and the magi API token; papai passes none. The `coding.secrets` permission
   is declared _only_ to read the repo catalogue (`buildCodingReposFacade` is gated by the same
   permission as `buildCodingSecretsFacade` in `src/plugins/tool-runtime.ts`); the plugin never
   calls `codingSecrets.resolve*()`.

---

## 3. nerv HTTP contract (the surface this plugin speaks to)

From `../nerv/src/http/routes/tasks.ts` (bearer `NERV_AUTH_TOKEN`, exact-match in
`../nerv/src/http/auth.ts`):

```
POST /tasks
  body: {
    kind?: string = 'gitlab-mr-supervision',
    prompt: string,                         // min 1
    repos: [{ projectPath: string }],       // min 1
    contextRef: { contextId: string, threadId?: string },
    source?: 'chat' | 'forge-event' = 'chat',
    costBudgetUsd?: number | null,
  }
  -> 201 { taskId }

GET /tasks/:id
  -> 200 <task doc>  |  404 { error: 'not found' }
     (task doc includes status, usageUsd, contextRef, taskRepositories[], mrUrl-ish fields)

POST /tasks/:id/events
  body: { type: 'chat_followup' | 'steer' | 'cancel', payload?: Record<string, unknown> = {} }
  -> 202 { ok: true }  |  404 { error: 'not found' }
     ('cancel' transitions the task to 'closed'; others enqueue a chat_instruction work item)
```

> **Cross-repo drift to coordinate (not papai code):** nerv's _foundation spec_ lists
> `targetBranch?` on `POST /tasks`, but the current route zod schema does **not** include it (it
> lists `kind`, `prompt`, `repos`, `contextRef`, `source`, `costBudgetUsd`). zod strips unknown
> keys, so the plugin sending `targetBranch` is harmless but a **no-op** until nerv adds it to the
> schema. The plugin will send it (derived from the catalogue `baseBranch`); tracked here as a
> nerv-side follow-up.

---

## 4. Manifest (`plugins/nerv/plugin.json`)

```jsonc
{
  "id": "nerv",
  "name": "nerv Coding Tasks",
  "version": "1.0.0",
  "description": "Create and supervise long-running GitLab-MR coding tasks via the nerv supervisor service",
  "apiVersion": 1,
  "main": "index.ts",
  "contributes": {
    "tools": [
      "create_coding_task",
      "coding_task_status",
      "list_coding_tasks",
      "followup_coding_task",
      "steer_coding_task",
      "cancel_coding_task",
    ],
    "commands": ["nerv"],
    "promptFragments": ["nerv-hint"],
  },
  "permissions": ["http", "storage", "commands", "coding.secrets"],
  "storageScope": "group",
  "providerAllowedHostsFromConfig": ["nerv_base_url"],
  "defaultEnabled": false,
  "configRequirements": [
    {
      "key": "nerv_base_url",
      "label": "nerv Base URL",
      "required": true,
      "sensitive": false,
      "scope": "admin",
    },
    {
      "key": "nerv_token",
      "label": "nerv Bearer Token",
      "required": true,
      "sensitive": true,
      "scope": "admin",
    },
  ],
  "activationTimeoutMs": 5000,
}
```

Notes:

- `permissions` includes `coding.secrets` **only** to obtain the `codingRepos` facade (repo
  catalogue). The plugin never resolves user coding secrets — nerv owns forge/magi creds.
- `storageScope: "group"` (D4): group-shared `plugin_kv` so `list_coding_tasks` spans a group's
  threads; the tool runtime still receives the **raw thread-scoped** `storageContextId` (documented
  behavior in `docs/architecture/plugins.md`), which the plugin needs for the contextId round-trip
  and for the `active:<thread>` pointer.
- Because plugin source cannot static-import bare modules (discovery rejects them), tools use raw
  JSON-Schema `inputSchema` with manual guards and structural types — same constraint as acp.

---

## 5. Token / config matrix (papai side only)

| Shared secret                     | Set on papai as                        | Must equal nerv's    |
| --------------------------------- | -------------------------------------- | -------------------- |
| papai → nerv bearer               | plugin admin config `nerv_token`       | `NERV_AUTH_TOKEN`    |
| nerv → papai `/api/notify` bearer | papai env/DB `NOTIFY_TOKEN` (existing) | `PAPAI_NOTIFY_TOKEN` |

`nerv_base_url` (admin, allowlisted via `providerAllowedHostsFromConfig`) is nerv's public origin.
All other secrets in the full stack matrix (`MAGI_TOKEN`, `FORGE_TOKEN`, `MAGI_FORGE_TOKEN`, and
nerv's `NERV_AUTH_TOKEN` used as magi's `MAGI_NOTIFY_TOKEN`) are nerv/magi-side and out of scope
for papai. Deployment must also point magi's `MAGI_NOTIFY_URL` at nerv (not papai).

---

## 6. The contextId round-trip (the correctness linchpin)

```
papai mints storageContextId  (pi:<inst>:ctx:<chan>:thread:<t>, src/chat/scoped-context.ts)
  → plugin sends it as         POST /tasks .contextRef.contextId
    → nerv stores it, forwards as  magi POST /sessions .contextId
      → magi echoes it verbatim in  POST /notify {contextId}  → to nerv
        → nerv correlates the task by contextId (Task.findOne)
   and nerv → papai /api/notify uses the same contextId, decoded by buildNotifyTarget
      back to platform + channel + thread.
```

- The plugin sends `contextRef.contextId = runtimeContext.storageContextId` (the raw thread-scoped
  id it receives).
- `contextRef.threadId` is **omitted**: it is redundant (already encoded in `storageContextId`),
  the plugin cannot import `parseScopedContextId` (bare-module restriction), and nerv treats
  `threadId` as optional. papai's `buildNotifyTarget` re-derives the thread from the scoped id.

---

## 7. projectPath derivation (D1)

`create_coding_task` accepts `project` (a catalogue name) and optionally `projects: string[]` for
multi-repo fan-out. For each name:

1. `repo = runtimeContext.codingRepos.get(name)`; unknown → `{ error: 'not_found', message: 'No
repository named "<name>". Add it in settings → Repositories.' }`.
2. Derive `projectPath` from `repo.repoUrl`: take `new URL(repoUrl).pathname`, strip the leading
   `/` and a trailing `.git`. e.g. `https://gitlab.com/group/sub/repo.git` → `group/sub/repo`.
3. **GitLab pre-flight** (mirrors acp's `canDeriveForge`): if `new URL(repoUrl).host` is not a
   GitLab host, refuse `{ error: 'not_configured', message: 'nerv supervises GitLab MRs; "<name>"
is on <host>.' }`. nerv's only `kind` today is `gitlab-mr-supervision`.
4. `targetBranch` = `repo.baseBranch` (sent; see §3 drift note).

The task body's `repos` is the array of derived `{ projectPath }`. `kind` defaults to
`gitlab-mr-supervision` (omitted → nerv defaults); an optional `kind` tool arg overrides.
`costBudgetUsd` is an optional numeric tool arg passed through.

---

## 8. Tools → nerv calls

| Tool                   | nerv call                                                       | Behavior                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_coding_task`   | `POST /tasks`                                                   | Body `{kind?, prompt, repos:[{projectPath}], contextRef:{contextId}, source:'chat', targetBranch?, costBudgetUsd?}`. Refuses if the thread already has a live task (§9). On `201`, writes a local `TaskRecord` and sets `active:<thread>` → taskId. |
| `coding_task_status`   | `GET /tasks/:id`                                                | taskId auto-resolved from the thread (optional explicit `taskId`). Surfaces `status` + `usageUsd`; refreshes the local record.                                                                                                                      |
| `list_coding_tasks`    | local records + bounded `GET /tasks/:id`                        | Lists the group's `TaskRecord`s, enriched with live status/cost via `p-limit`-bounded GETs (nerv has no list endpoint).                                                                                                                             |
| `followup_coding_task` | `POST /tasks/:id/events {type:'chat_followup', payload:{text}}` | taskId auto-resolved from the thread.                                                                                                                                                                                                               |
| `steer_coding_task`    | `POST /tasks/:id/events {type:'steer', payload}`                | taskId auto-resolved from the thread.                                                                                                                                                                                                               |
| `cancel_coding_task`   | `POST /tasks/:id/events {type:'cancel'}`                        | taskId auto-resolved; clears `active:<thread>` on success.                                                                                                                                                                                          |

All calls go through a `callNerv()` helper — a structural copy of acp's `callMagi()`
(`Authorization: Bearer <nerv_token>`, JSON body, non-2xx normalized to
`{ error: 'nerv_error', status, body }`) — over `providerRuntime.httpFetch` with the base URL
allowlisted. When `nerv_base_url`/`nerv_token` is unset, tools return a `NOT_CONFIGURED` sentinel.

---

## 9. Task model — one task per thread (D2)

Because nerv correlates notifications 1:1 by `contextId`, each thread owns at most one live task.

Local `plugin_kv` (group-scoped) holds two key families:

- `task:<taskId>` → `TaskRecord { taskId, storageContextId, title, repos, createdAt, status?, mrUrl?, usageUsd? }`
- `active:<storageContextId>` → `taskId` (the thread's current task; O(1) auto-resolve)

Resolution: `followup`/`steer`/`cancel`/`status` read `active:<runtimeContext.storageContextId>`
to get the taskId — the LLM need not supply one (an explicit `taskId` arg overrides for
power-use). If no active task and no explicit taskId → `{ error: 'not_found', message: 'No coding
task is running in this thread.' }`.

Create guard: `create_coding_task` refuses when `active:<thread>` maps to a task whose last-known
`status` is non-terminal → `{ error: 'conflict', message: 'A coding task is already running in
this thread — cancel it or wait for it to finish.' }`. Terminal statuses (`completed`, `closed`,
`failed`) free the thread: `cancel` clears the pointer immediately, and `status`/`list` clear it
opportunistically when they observe a terminal status (so a naturally-finished task doesn't block
the next `create`).

`title` = first non-empty prompt line, clipped (reuse acp's `deriveTitle`).

---

## 10. Module layout (structural copy-adapt of `plugins/acp/`)

```
plugins/nerv/
  plugin.json        manifest (§4)
  client.ts          callNerv(), readNervConfig(), NOT_CONFIGURED, arg guards  (copy of acp/client.ts)
  schemas.ts         raw JSON-Schema inputSchema per tool
  tools.ts           RuntimeContext type, projectPath derivation, GitLab pre-flight, create/status/list
  event-tools.ts     followup / steer / cancel (POST /tasks/:id/events)
  history.ts         TaskRecord type + read/write/deriveTitle          (copy of acp/history.ts)
  task-records.ts    record + active-pointer helpers                    (copy of acp/session-records.ts)
  index.ts           factory + activate(): register tools/command/fragment (copy of acp/index.ts)
```

`RuntimeContext` needs only `{ storageContextId, adminConfig, kv, codingRepos }` — a subset of
acp's (no `codingSecrets` usage).

---

## 11. Operator gating (parity)

Reuse the **existing** coding `whoMayUse` guardrail rather than a new nerv policy — nerv tasks
drive the same magi coding sessions, same risk/cost profile.

- In `src/llm-orchestrator-tools.ts`, add the nerv **action** tools
  (`plugin_nerv__create_coding_task`, `__followup_coding_task`, `__steer_coding_task`,
  `__cancel_coding_task`) to the gated set alongside `ACP_SESSION_ACTION_TOOLS` (either extend
  that set or add a sibling and union them in `applyWhoMayUseFilter`). Read-only tools
  (`coding_task_status`, `list_coding_tasks`) stay available.
- Guests are already reduced to read-only earlier by `applyGuestReadOnlyFilter`.

This is the **only** required edit outside `plugins/nerv/`.

---

## 12. Prompt fragment, command, and acp coexistence

Both plugins can be enabled; the LLM routes by intent. Fragments make the contrast explicit:

- **`nerv-hint`:** "For long-running, supervised code work — watch a GitLab MR until CI is green,
  iterate on review comments, work across multiple repos — use `create_coding_task(project,
prompt)`. It runs until done and notifies you; use `followup_coding_task` / `steer_coding_task`
  / `cancel_coding_task` to guide or stop it, and `coding_task_status` / `list_coding_tasks` to
  check progress. For a single one-shot change that opens a PR now, use `start_session` (acp)
  instead."
- acp's `acp-hint` fragment is unchanged.
- `/nerv` command prints a short natural-language explainer (mirrors `/acp`).

Prompt-fragment budgets (2,000 chars/fragment, 8,000 total) apply.

---

## 13. Cost surfacing

nerv already includes a cost headline in its `/api/notify` markdown (`PapaiTaskNotifier`
`costHeadline`), so **push** cost arrives with no plugin wiring. **Pull** side: `coding_task_status`
and `list_coding_tasks` read `usageUsd` from the task doc and include it in the tool result.

---

## 14. Testing (mirror acp's plugin suite; see `tests/CLAUDE.md`)

- **Schema validation** — every tool `inputSchema` validates representative inputs
  (`schemaValidates()`).
- **Tool executors** with a mock `httpFetch` + mock `codingRepos`:
  - `create_coding_task`: catalogue lookup, `projectPath` derivation, multi-repo array, GitLab
    pre-flight refusal (non-GitLab host), unknown-project `not_found`, correct `POST /tasks` body
    (contextId = storageContextId, `source:'chat'`, `targetBranch` from baseBranch), record +
    `active:<thread>` written on `201`.
  - one-task-per-thread: `create` refuses on a live `active:<thread>`; terminal status clears the
    pointer; `cancel` clears it.
  - `followup`/`steer`/`cancel`: auto-resolve taskId from the thread; correct event `type`;
    `not_found` when no active task.
  - `coding_task_status`/`list_coding_tasks`: enrichment via `GET /tasks/:id`, `usageUsd`
    surfaced, bounded concurrency.
  - `NOT_CONFIGURED` when `nerv_base_url`/`nerv_token` unset.
- **Record store** round-trip (`task-records.ts`/`history.ts`), including legacy-tolerant reads if
  copied verbatim from acp.
- **Gating** — `applyWhoMayUseFilter` removes the four nerv action tools for off-allowlist actors
  and keeps status/list.

---

## 15. Out of scope (YAGNI)

- No BYO provider key / forge token in the plugin — nerv owns them.
- No transcript viewer — that is acp/magi's surface.
- No separate inbound router — chat follow-ups reach nerv through normal LLM tool-calling.
- No group `coding_identity` resolution — no per-user credentials are involved.
- No `forge-event` `source` — that is nerv's own forge-poll path, not a papai-initiated flow.

---

## 16. Cross-repo coordination checklist (not papai code)

- nerv: add `targetBranch` to the `POST /tasks` zod schema (currently stripped) — §3.
- Deploy: `nerv_token` == nerv `NERV_AUTH_TOKEN`; papai `NOTIFY_TOKEN` == nerv `PAPAI_NOTIFY_TOKEN`;
  magi `MAGI_NOTIFY_URL` → nerv.

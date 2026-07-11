<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# kiss → papai Migration · Phase 0: Reliability & Enablement (implementation design)

> **Parent roadmap.** `2026-07-11-kiss-to-papai-migration-roadmap-design.md` (phase P0). This spec
> details P0 to implementation level and is the input to a writing-plans plan.
>
> **Goal.** Make the papai → nerv (durable) coding path **trustworthy**, then turn it on. What the bot
> says it did, it did.
>
> **Repos touched.** `papai` (this repo), `../nerv`, `../magi` (no code change — reuses an existing
> endpoint), plus an operator runbook doc.
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-11). Cross-repo facts for
> nerv/magi are anchored to those repos.

## Decisions of record

1. **Steer is merged into one honest tool** — `steer_coding_task` is removed; a single
   `followup_coding_task` remains, described as "queued and applied at the next checkpoint." (Both hit
   the identical `chat_instruction` path today; the distinction was dishonest.)
2. **Cancel reaps magi inline, best-effort** — a new `SupervisorService.cancelTask` cancels each repo's
   magi session (tolerating already-gone sessions), then closes the task.
3. **Output-language toggle is complete** — it governs the _primary_ task output, which requires nerv to
   inject an operating-instructions preamble into the start prompt + chat_followup (today forwarded
   verbatim), not merely swap a hardcoded string.
4. **Enablement ships a lightweight health check + an operator runbook**, not docs alone.

---

## Component 1 — F1 wire fix + honest ack (papai + nerv)

**Problem (verified).** papai posts the instruction as `payload.text`
(`plugins/nerv/event-tools.ts:34-37`); nerv reads `payload.prompt`
(`../nerv/src/supervisor/foundationHandlers.ts:124`). The field mismatch makes `prompt` resolve to `''`,
so the handler's `if (repo?.magiSessionId && prompt)` guard skips `magi.followUp` — the instruction is
silently dropped. nerv's event route accepts `payload` opaquely (`z.record(z.unknown())`,
`../nerv/src/http/routes/tasks.ts:14-17`), so nothing rejects the wrong shape. The success
acknowledgement is emitted **unconditionally** by nerv's `chat_instruction` handler regardless of whether
`followUp` fired.

**Changes.**

1. **papai** `plugins/nerv/event-tools.ts:34`: send `payload: { prompt }` (rename the wire field only;
   the user-facing tool input arg stays `text` per `schemas.ts:48-56`). Map `payload: { prompt: text }`.
2. **nerv** `src/http/routes/tasks.ts:14-17`: replace the opaque payload with a typed schema. For
   `chat_followup`, require `payload: z.object({ prompt: z.string().min(1) })`; return **400** on a
   missing/blank prompt (fail loud — this would have caught F1). `cancel` keeps an empty payload.
3. **nerv** `src/supervisor/foundationHandlers.ts` (chat_instruction handler): gate the success notify on
   `followUp` actually dispatching (a `taskRepositories` entry with a `magiSessionId` exists). When no
   active session is found, notify an honest message ("couldn't apply — no running coding session"),
   never a false "applying your instruction."

**Contract change.** Registry #1 (papai→nerv event body `text` → `prompt`; ack conditional on enqueue).

**Tests.** papai `tests/plugins/nerv/event-tools.test.ts` — assert the posted body is
`payload.prompt`. nerv `tests/http/server.test.ts` — `chat_followup` with a missing prompt → 400;
happy path → `followUp` dispatched + success notify; no-active-session → honest no-op notify. A new
**papai↔nerv contract test** pins the `payload.prompt` shape on both sides (standing anti-drift practice
from the roadmap risk table).

---

## Component 2 — Merge steer into followup (papai + nerv)

**Problem (verified).** nerv discards the event `type`; `chat_followup` and `steer` both fall through to
the same `enqueueOnce({ kind: 'chat_instruction', ... })` (`../nerv/src/http/routes/tasks.ts:47-52`).
papai exposes them as two tools implying a difference that does not exist.

**Changes.**

1. **papai:** remove `steer_coding_task` from tool registration (`plugins/nerv/index.ts`),
   `plugin.json` `contributes.tools`, `plugins/nerv/schemas.ts`, and `plugins/nerv/event-tools.ts:52-59`.
   Keep `followup_coding_task` (`event-tools.ts:43-50`) with an honest description: "Queue a message or
   instruction for the running task; it is applied at the next checkpoint."
2. **papai:** remove `steer_coding_task` from `NERV_TASK_ACTION_TOOLS` (`src/llm-orchestrator-tools.ts:46-51`,
   the `whoMayUse` gate) and from the `nerv-hint` prompt fragment (`plugins/nerv/index.ts:103`).
3. **nerv:** drop `'steer'` from the event `type` enum (`src/http/routes/tasks.ts:14`).
4. **papai:** update `tests/plugins/nerv/manifest.test.ts` (it asserts `contributes.tools` ==
   registered tools).

**Contract change.** Registry narrowing — event `type` enum loses `steer`.

---

## Component 3 — Cancel reaps magi (nerv)

**Problem (verified).** nerv's cancel path transitions the task to `closed` and notifies, but never tells
magi to stop the session (`../nerv/src/http/routes/tasks.ts:43-46`). `MagiClient` has no cancel method
(`../nerv/src/services/MagiClient.ts`). The magi endpoint **already exists**:
`POST /sessions/:id/cancel`, bearer auth, returns the session or `404`
(`../magi/src/server/router.ts:139-142`). Session ids are per-repo:
`task.taskRepositories[].magiSessionId` (`../nerv/src/db/models/Task.ts:23,68`).

**Changes.**

1. **nerv** `src/services/MagiClient.ts`: add `cancelSession(sessionId: string): Promise<unknown>` →
   `POST /sessions/${sessionId}/cancel` via the existing private `call`.
2. **nerv** `src/services/SupervisorService.ts`: add `cancelTask(id)` — load the task; for each
   `taskRepositories` entry with a `magiSessionId`, call `cancelSession` **best-effort** (try/catch +
   log; a 404/error is tolerated — the session may already be gone), iterating with the same pattern as
   `startTask` (`SupervisorService.ts:80`); **then** `tasks.transition(id, 'closed')` +
   `notifier.notifyStatus(closed, 'closed')`.
3. **nerv** `src/http/routes/tasks.ts:43-46`: the `cancel` branch calls `deps.supervisor.cancelTask(id)`
   instead of transitioning inline (thread `supervisor` into the route deps).

**Contract change.** Registry #3 (nerv→magi cancel) — reuses the existing magi endpoint; **no magi
change**.

**Tests.** nerv: `cancelTask` cancels every session, tolerates one failing session and still closes,
and closes cleanly when no session ids are present. `MagiClient.cancelSession` posts to the right path
with bearer auth.

---

## Component 4 — Output language governs main output (papai + nerv)

**Problem (verified).** The English directives live in `../nerv/src/services/prompts.ts:75` (inside
`buildEngineeringOperatingInstructions`) and the `RESULT_FORMAT_*` templates (`:555, :565, :576-577,
:589-590`) — but these **only reach the fix / CI / self-review follow-up flows**. The initial task
prompt (`SupervisorService.startTask:94-96`) and chat_followup (`foundationHandlers.ts:124-131`) forward
the raw prompt **verbatim**; `generateTaskPrompt` is dead code. So a real toggle must add prompt
injection, not just parameterize a string. No language/locale field exists in the create-task path
(`../nerv/src/http/routes/tasks.ts:5-12`, `TaskService.ts:5-12`, `Task.ts:41-64`).

**Changes — papai.**

1. Read a **per-context config key `output_language`** (optional) at the `create_coding_task` call site
   and thread it into `RuntimeContext` (`plugins/nerv/tools.ts:28-42`) — add the field to whatever
   constructs the plugin RuntimeContext, sourced from per-context config (`contextConfig.get('output_language')`).
2. Add `outputLanguage` to the create-task payload in `buildCreateTaskBody` (`plugins/nerv/tools.ts:122-139`)
   as an optional spread. Unset → omitted → nerv defaults to English.
3. Update `tests/plugins/nerv/create-task.test.ts` (it asserts the exact payload shape).

**Changes — nerv.**

1. Add `outputLanguage?: string` to `createTaskBody` (`src/http/routes/tasks.ts:5-12`), `CreateTaskInput`
   - `TaskService.create` passthrough (`src/services/TaskService.ts:5-32`), and `ITask` + `taskSchema`
     (`src/db/models/Task.ts:41-102`).
2. Parameterize `buildEngineeringOperatingInstructions(language)` (`prompts.ts:75`) and make the
   `RESULT_FORMAT_*` "in English" occurrences language-driven (`:555, :565, :576-577, :589-590`).
3. **Inject an operating-instructions preamble** (the existing `shared` engineering directives + the
   language line, kept minimal) into the **start prompt** (`SupervisorService.startTask:94`) and
   **chat_followup** (`foundationHandlers.ts:124`), which today forward verbatim. Use
   `language = task.outputLanguage ?? 'English'`.

**Deliberate consequence (accepted).** nerv begins injecting a start-prompt preamble it did not before —
a small, intended step toward nerv owning the prompt convention (kiss did this). Scope is kept minimal
and language-focused for P0.

**Contract change.** Registry #2 (create-task gains `outputLanguage`).

**Tests.** nerv `tests/services/prompts.test.ts` — directives render in the configured language; the
start prompt now carries the preamble; default stays English. papai create-task test asserts the new
optional field is passed when configured and omitted when not.

---

## Component 5 — Enablement: health check + runbook (nerv + papai + docs)

**Problem (verified).** `plugins/nerv/plugin.json` ships `defaultEnabled: false` with required admin
config `nerv_base_url` / `nerv_token`; `readNervConfig` (`plugins/nerv/client.ts:12-17`) returns `null`
when unset and every tool short-circuits to `NOT_CONFIGURED`. There is **no** health/ping anywhere, and
`docs/architecture/environment.md` never mentions nerv.

**Changes.**

1. **nerv:** add `GET /health` → `200 { ok: true }` (liveness).
2. **papai:** a connectivity probe that calls nerv `/health` using the configured
   `nerv_base_url`/`nerv_token`, surfaced in the settings/admin coding section as **connected /
   misconfigured** (follows the existing plugin-admin-config presentation pattern).
3. **docs:** an operator runbook — the config keys, enabling the default-off plugin, verifying
   `MAGI_NOTIFY_URL` points at nerv on the magi deployment, and a smoke-test checklist (create → PR →
   review-fix → CI-fix → cancel-and-reap → language toggle).

**Contract change.** New nerv `GET /health`.

---

## Cross-repo contract summary (updates roadmap §4)

| #   | Interface            | Producer → Consumer | P0 change                                                             |
| --- | -------------------- | ------------------- | --------------------------------------------------------------------- |
| 1   | follow-up event body | papai → nerv        | `payload.text` → `payload.prompt`; typed schema; conditional ack      |
| —   | event `type` enum    | papai → nerv        | remove `steer`                                                        |
| 2   | create-task payload  | papai → nerv        | add optional `outputLanguage`                                         |
| 3   | session cancel       | nerv → magi         | new `MagiClient.cancelSession` → existing `POST /sessions/:id/cancel` |
| —   | health               | papai → nerv        | new `GET /health` liveness                                            |

---

## Testing strategy

- **TDD per repo.** Each change lands test-first.
- **Contract test (anti-drift).** A shared-shape test pins `payload.prompt` on the papai emit side and
  the nerv parse side — the F1 class of bug must fail a test, not ship silently.
- **nerv integration.** Cancel-reap (all sessions, one-failing-tolerated, no-sessions); F1 round-trip
  (happy, missing-prompt-400, no-active-session honest notify); prompt-language rendering + start-prompt
  preamble.
- **papai plugin.** Updated event-tools/create-task/manifest tests for the renamed field, dropped tool,
  and new optional payload field.
- **Smoke test** (manual, in the runbook) gates enablement in staging.

## Error handling

- F1 schema miss → **400** with a clear message (not a silent no-op).
- Cancel reap → per-session failures are logged and tolerated; they never block the task close.
- Health probe timeout / non-2xx → surfaced as "not connected," never a hard crash.

## Build order & acceptance

Order: **C1 + C2 (trust fixes) → C3 (cancel) → C4 (language) → C5 (enablement)**. C4 is the largest;
C1/C2/C3 are independent and can land first.

**Phase-0 acceptance gate (from the roadmap):** follow-up / cancel / steer(→followup) round-trip tests
green; the ack fires only on real dispatch; cancelling a task provably stops all its magi sessions; nerv
runs in a staging platform instance through a full loop (create → PR → review-comment fix → CI fix →
cancel-and-reap); RU and EN output both verified via the toggle; `/health` probe reflects real state.

## Open assumptions (recorded)

- Config key name is **`output_language`**; the papai health probe lives in the **settings/admin coding
  section**. Both are low-cost to change if a different convention is preferred.
- The papai plugin RuntimeContext can expose per-context config (`contextConfig.get`) to the create-task
  tool; if not already wired, threading it in is part of Component 4.
- nerv's per-context config for `output_language` is sourced by papai and passed at task creation; nerv
  itself stores only the resolved string on the Task.

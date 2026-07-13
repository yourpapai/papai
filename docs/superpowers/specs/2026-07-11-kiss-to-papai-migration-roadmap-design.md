<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# kiss → papai Migration Roadmap (program design)

> **Type.** Program roadmap. Decomposes the kiss→papai migration into four sequential phases across the
> `papai` + `nerv` + `magi` repos. Every phase is specified at **roadmap granularity** (goal, work
> items, cross-repo contract changes, acceptance gate, dependencies) — **not** to code level. Each phase
> becomes its own brainstorming → spec → plan cycle when reached; this document is the parent they hang
> off.
>
> **Source of truth for the gaps.** `../kiss-to-papai-migration-ux-report.md` (the scenario-by-scenario
> UX comparison) and its upstream evidence: kiss `README.md`/`docs/scenarios/`, papai
> `docs/architecture/coding-stack-overview.md`, nerv `docs/kiss-to-nerv-parity-matrix.md`, and the prior
> `../kiss-vs-papai-nerv-magi-geofront-gap-analysis.md`.
>
> **Repo scope.** Full stack — `papai`, `../nerv`, `../magi` are all in scope to change.

---

## 1. Finish line (the constitution)

The migration target is **deliberate divergence**: reproduce kiss's core loop faithfully, do the rest
papai's native way, and **consciously drop** what fights papai's architecture. Every ruling below is a
decision of record; dropped items are **recoverable** (backlog, §6), not silent omissions.

### 1.1 KEEP — faithful parity (this is the migration)

- Forge-triggered autonomy — "assign the bot to an MR" and it supervises it (P1).
- Reliable steer / follow-up — no false acknowledgements (P0).
- Reliable cancel — actually stops the underlying run (P0).
- Review-comment auto-response + CI auto-fix loop — already ported in nerv; reached once nerv is on.
- Stale-MR nudge; honest status reporting.
- **Crash auto-resume** of an in-flight run (P2) — the one depth item kept as must-have.

### 1.2 DIVERGE — keep the capability, do it papai's way (substitution, not loss)

| kiss mechanism                     | papai-native replacement                                                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `/fork` `/branch` inline commands  | natural-language branch control (LLM-extracted); optional thin adapter      |
| "Analytical" task type             | papai's native chat Q&A / read-only session                                 |
| "Design" (DESIGN.md-only) type     | a prompt convention, not a first-class type                                 |
| `:loading:` reaction state machine | papai live-status + `/api/notify` messages                                  |
| repo skills (`.agents/skills`)     | papai custom instructions + long-term memory (magi still reads `AGENTS.md`) |
| idle self-stop + silent rewake     | geofront/magi sandbox lifecycle (internal, not user-facing)                 |
| output language (RU vs EN)         | **per-context config toggle**, default derived from the platform instance   |

### 1.3 DROP / defer — won't-do for v1 (recoverable)

Self-review pass-2 · hard cost cap + cost transparency **(flag: removes the only budget guardrail)** ·
multi-repo shared workspace (atomic cross-repo turn) · true pre-emptive steer · normal-mode channel
("every message = a task") + `:no-bot:` · `.qwenignore` · auto-review via `ayaya_bot` · live-cost block
patched into the MR description · Mattermost offline-catch-up (nice-to-have) · git submodule auto-init
(verify need) · full MCP-fleet completion (tracked separately in the `kiss-mcp-plugins` plans).

---

## 2. Sequencing

**Strict serial: P0 → P1 → P2 → P3.** Each phase is fully done and shipped, with its acceptance gate
met, before the next begins. Chosen for the simplest management, clearest per-phase gates, and the
strongest trust guarantee (no user is onboarded before the reliability phase closes). The trade-off —
slower wall-clock and idle magi capacity during P0/P1 — is accepted.

```
P0 Reliability & enablement ─▶ P1 Assign-the-bot trigger ─▶ P2 Crash auto-resume ─▶ P3 Rollout & polish
   papai · nerv                   nerv · papai                magi · nerv             papai · nerv · magi · ops
```

---

## 3. Phases

### P0 · Reliability & enablement

**Goal.** Make the nerv (durable) path trustworthy, then turn it on. What the bot says it did, it did.

**Work items.**

1. **Fix F1 (false-ack).** papai sends the follow-up/steer body as `payload.text`; nerv reads
   `payload.prompt` — the guard fails and `magi.followUp` never fires, yet papai still replies "Got it —
   applying your instruction." Align the field, and make papai's ack **conditional on nerv actually
   enqueuing** (2xx + accepted), not fire-and-forget.
2. **Cancel reaps magi.** `cancel_coding_task` closes the Task but leaves magi session(s) running. nerv
   must call the **existing** magi `POST /sessions/:id/cancel` for every session of the task before
   transitioning to `closed`.
3. **Steer honesty.** `steer_coding_task` and `followup_coding_task` route to the identical
   `chat_instruction` path (no mid-turn injection). Collapse to one honest "message-the-task" semantic
   (queued at the next boundary) and remove the implied immediacy. True pre-emptive steer → backlog (§6).
4. **Enable nerv.** Operator config (`nerv_base_url`, `nerv_token`); verify `MAGI_NOTIFY_URL` points at
   nerv for the supervised path; ship a smoke-test checklist. (`plugins/nerv` ships with
   `defaultEnabled: false` — this is an enablement/runbook task, not new plugin code.)
5. **Output-language toggle.** nerv `prompts.ts` currently hardcodes English (the port flipped kiss's
   Russian). Read a per-context language key instead; papai passes the preference at task creation.

**Cross-repo contract changes.** papai→nerv event payload field `text` → `prompt`; papai→nerv
create-task gains `outputLanguage`. **No magi change.**

**Acceptance gate.** Follow-up / cancel / steer round-trip integration tests green; the ack fires only
on real enqueue; cancelling a task provably stops all its magi sessions; nerv running in a staging
platform instance through a full loop (create → PR → review-comment fix → CI fix → cancel-and-reap); RU
and EN output both verified via the toggle.

**Depends on.** — (entry phase).

### P1 · Assign-the-bot trigger

**Goal.** Restore kiss's #1 habit on papai: a user assigns the bot to a GitLab MR (or mentions it in a
mapped channel) and it adopts and supervises the MR — no chat message required to start.

**Work items.**

1. **Forge-event producer.** A GitLab assignee poll (and/or webhook receiver) detects the bot being
   assigned as reviewer/assignee on an MR and creates a nerv task with `source: 'forge-event'` (today
   schema-legal but with zero producers), adopting the existing MR's branch/PR context.
2. **Project → chat-context binding.** A forge-triggered task has no originating chat thread, so its
   notifications need a repo/project → chat-channel mapping (the equivalent of kiss's `Project` → channel
   map). New concept; introduced here.
3. **MR adoption semantics.** Handle open discussions, skip already-resolved ones, watch CI — reuses
   nerv's existing `review_comment` / `pipeline_failure` handlers.
4. **NL command adapter.** `/fork` / `/branch` / reviewer-assignment phrasing produces the correct
   branch behaviour (natural-language extraction; thin literal adapter optional).
5. **Unassign = stop.** Bot removed from the MR → cancel the task (reuses P0's reap).

**Cross-repo contract changes.** New forge → nerv `source: 'forge-event'` task-creation path; new
Project → chat-context binding in the config registry (papai + nerv).

**Acceptance gate.** Assigning the bot to a test MR auto-creates a task, adopts the MR, handles open
discussions, and watches CI with **no chat message**; un-assigning cancels and reaps; forge-triggered
notifications land in the bound channel; branch directives are honoured.

**Depends on.** P0 (needs reliable cancel, enabled nerv, honest notify).

### P2 · Crash auto-resume

**Goal.** An in-flight run whose agent/container dies resumes automatically — no manual follow-up nudge.

**Work items.**

1. **magi auto-restart.** Detect a dead session (process/container died mid-turn), auto-restart it
   restoring worktree/branch/session state, and surface a resumable/dead signal on `GET /sessions/:id`.
2. **nerv redispatch.** `staleTaskSweep` triggers a magi resume/redispatch instead of only resetting the
   work-item lease.
3. **Idempotency.** Resume must not double-apply commits/comments — gate on the existing
   `processedNoteIds` / `processedJobIds` ledgers.

**Cross-repo contract changes.** magi `GET /sessions/:id` gains a dead/resumable status + internal
auto-restart; nerv → magi resume/redispatch call.

**Acceptance gate.** Killing an agent mid-turn lets the task run to completion without a manual nudge;
no duplicate commits or comments after resume.

**Depends on.** P1 (strict serial).

### P3 · Rollout & polish

**Goal.** Safe cutover mechanics and observability.

**Work items.**

1. **Shadow / dual-run runbook.** Run papai + nerv alongside kiss on the same repos; adopt kiss-created
   MRs (via P1); compare outputs; cut over per project.
2. **Config importer.** Map kiss `Project` records (channel → repos → `pipelineJobTrackList` → creds →
   `selfReviewEnabled` / `maxTaskCost`) into papai `coding_guardrails` + the nerv `Project` registry +
   per-user forge identity.
3. **Transcript / observability restore.** magi mints `shareToken` / `transcriptUrl` (currently missing
   in verified source); papai's `/t/<token>` proxy goes live; the transcript link is surfaced on **nerv**
   tasks too (today nerv tasks have no observability surface at all).
4. **Nice-to-have if time.** Mattermost offline-catch-up cursor; submodule auto-init (only if target
   repos need it).

**Cross-repo contract changes.** magi `POST /sessions` response gains `shareToken` / `transcriptUrl`;
the importer reads the kiss Mongo `Project` schema.

**Acceptance gate.** One real project migrated via the importer; a shadow-run demonstrates parity; the
transcript link works for both ACP and nerv tasks; the cutover checklist is executed end-to-end.

**Depends on.** P0–P2.

---

## 4. Cross-repo contract registry

Single source of truth for every papai ↔ nerv ↔ magi interface the roadmap changes. Each phase's future
spec references this table rather than re-deriving contracts.

| #   | Interface                      | Producer → Consumer | Change                                                       | Phase |
| --- | ------------------------------ | ------------------- | ------------------------------------------------------------ | ----- |
| 1   | follow-up/steer event body     | papai → nerv        | field `text` → `prompt`; ack conditional on enqueue          | P0    |
| 2   | create-task payload            | papai → nerv        | add `outputLanguage`                                         | P0    |
| 3   | session cancel                 | nerv → magi         | call **existing** `POST /sessions/:id/cancel` per session    | P0    |
| 4   | forge-event task creation      | forge/nerv → nerv   | wire `source: 'forge-event'` (zero producers today)          | P1    |
| 5   | Project → chat-context binding | config registry     | new mapping so forge-triggered notifications route           | P1    |
| 6   | session dead/resumable status  | magi → nerv         | new signal on `GET /sessions/:id` + auto-restart             | P2    |
| 7   | session resume/redispatch      | nerv → magi         | new resume call                                              | P2    |
| 8   | session share token            | magi → papai        | `POST /sessions` response gains `shareToken`/`transcriptUrl` | P3    |

---

## 5. Risks & mitigations

- **Forge-triggered task has no chat context** → the Project → chat-context binding (P1) is the
  mitigation; it is a prerequisite, not an add-on.
- **magi resume idempotency** → reuse `processedNoteIds` / `processedJobIds` ledgers so a resumed turn
  cannot double-commit or double-comment.
- **F1-class wire drift across services** → contract tests for every registry interface become a
  standing practice, added as each phase lands (F1 itself was exactly this class of bug).
- **Strict-serial slows wall-clock / idles magi** → accepted; per-phase acceptance gates keep the
  serial chain honest and unambiguous.
- **Dropping the cost cap removes the only budget guardrail** → recorded as a conscious v1 won't-do;
  the pricing math already exists in nerv, so it is cheap to reinstate once magi exposes usage.

---

## 6. Deferred / won't-do backlog (recoverable)

Ordered roughly by likely future value. Each is a conscious divergence decision, not an oversight.

1. **Self-review pass-2** (auto-fix before MR) — needs magi synchronous follow-up read-back.
2. **Hard cost cap + cost transparency** — needs magi to expose token usage on its `Session`; nerv
   pricing math + `usageUsd` comparator already scaffolded.
3. **Multi-repo shared workspace** (atomic cross-repo turn) — heavy magi rewrite (today: one session per
   repo).
4. **True pre-emptive steer** — mid-turn interrupt/injection into a live magi turn.
5. **MCP-fleet completion** — tracked in the `kiss-mcp-plugins` plans; fold in as a parallel track if
   desired.
6. Normal-mode channel + `:no-bot:` · Mattermost offline-catch-up · submodule auto-init · `.qwenignore`
   · `ayaya_bot` auto-review · reaction state machine.

---

## 7. Open assumptions (recorded, not blocking)

- **nerv is GitLab-only for v1**; GitHub repos remain served via the ACP (interactive) path only.
- **magi's `POST /sessions/:id/cancel` exists** and is usable from nerv (verify at P0 start).
- **magi transcript routes** — confirm whether any `/sessions/:id/transcript` surface exists to build
  P3's `shareToken` work on, or whether it is greenfield.

---

## 8. How this roadmap is consumed

Each phase is planned and built as its own cycle: **brainstorming → `docs/superpowers/specs/` spec →
writing-plans plan → implementation**, gated by the acceptance criteria above. Start with **P0**. This
document is updated only when a phase boundary, contract, or finish-line ruling changes.

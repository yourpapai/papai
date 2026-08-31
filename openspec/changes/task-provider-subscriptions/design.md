# Design — task-provider-subscriptions (Session 4: docs, spec delta, verification)

## Context

Sessions 1–3 already shipped the code and tests, each with its own OpenSpec change still under `openspec/changes/`:

- `pin-alerts-to-task-instances` — `alert_prompts.task_instance_id` FK pin, cancel-on-switch/delete, poller routes by pinned instance.
- `alert-task-watch` — `task.id` eq pure-watch condition, targeted getTask polling, snapshot-visible-change firing.
- `alert-activity-condition` — `{kind:'activity', taskId, categories?}` via task history with a last-activity cursor, baseline-then-fire, `activities.read` creation gating, untrusted-content summaries.

The implementing modules are `src/deferred-prompts/{poller-alerts, poller-alerts-watch, poller-alerts-activity, poller-alerts-grouping, poller-alerts-summary, activity-gating, condition-eval, tool-handlers}.ts`; the tool surface is the existing `create_alert` (`src/tools/create-alert.ts`, registered via `src/tools/deferred-tools-builder.ts`). See proposal.md for why this closing session exists. This session writes documentation, the consolidated spec delta, and runs full verification — it changes no behavior.

## Goals / Non-Goals

**Goals:**

- One consolidated `task-subscriptions` capability in OpenSpec whose every requirement traces to a landed session delta — nothing invented, nothing dropped silently.
- Documentation that matches the code exactly: a condition reference in `docs/architecture/tools.md`, verified alert bullets in `docs/architecture/behaviors.md`, and a *verified no-op* for `docs/architecture/overview.md`.
- Verification driven off persisted report artifacts (`reports/test/`, `reports/checks/`), one full suite, per the AGENTS.md read-don't-rerun protocol.

**Non-Goals:**

- Archiving (or deciding the fate of) the three source changes — that is an operator action after this change lands; this change neither archives nor edits them.
- Any code, DB, dependency, or module change. Code is touched only if verification exposes a defect in a prior session's code, and then minimally.

## Decisions

### D1: One new capability, all-ADDED delta

`specs/task-subscriptions/spec.md` declares a **new** capability (`openspec/specs/task-subscriptions/` does not exist), so the delta is all `## ADDED Requirements`. Every requirement is copied-and-consolidated from the three source deltas; the only omission is the activity delta's "Existing alert behavior is preserved" requirement, whose two scenarios are coverage-redundant with the targeted-polling and pinning requirements already present.

*Alternative:* archive the three source changes into three separate main specs. Rejected: it fragments one user-facing capability ("subscribe to tracker changes") and leaves the genuinely cross-cutting requirements (cooldown/no-refire across all alert kinds, `tool_prefs` gating on `create_alert`) without a home in any of the three.

### D2: Docs claims verified against named source before writing

- `tools.md` — the condition reference states the three leaf shapes exactly as validated in `condition-eval.ts` / tool schema, and documents `tool_prefs` from the actual implementation: `create_alert` is classified `write` risk / `deferred` domain / `create` operation in `src/tools/tool-metadata.ts`; resolution is per-tool override (legacy alias honored) → domain default → risk default → implicit `allow`; `deny` removes the tool from the set, `ask` wraps each call in the `_permission_reason` user-confirmation flow, refusal returns the structured `permission_denied` result (`tool-preferences.ts`, `permission-gate.ts`). One consequence worth stating in the doc: the `read-only` preset sets `write: ask`, so under that preset `create_alert` is ask-gated.
- `behaviors.md` — each of the three alert bullets is checked against its `poller-alerts*` module; only the gaps the issue names (cancel-on-switch/delete semantics, creation-refusal guidance, targeted-vs-whole-list polling) are filled, plus fixes for any actual inaccuracy found.
- `overview.md` — expected verified no-op; edited only if a line is actually inaccurate.

*Alternative:* trust the existing bullets and write docs from the deltas. Rejected: the deltas are the contract, not the code; docs must match what shipped.

### D3: Defect handling is test-first, minimal, then re-verify

If the full suite or a check exposes a defect in prior sessions' code: write the failing test first, apply the minimal fix, re-run the affected file, then the full suite again. No opportunistic refactors.

### D4: No gating, scope-model, DB, or dependency impact — because nothing new is created

- **Tool surface:** none new. `create_alert` is unchanged; its gating (`activities.read` + configured task instance for activity conditions) shipped in session 3 and is only *documented* now.
- **Scope model:** this change persists nothing. For orientation, the landed state keys are: the pin is the task-instance id captured from the alert's delivery **config context** at creation and stored on the alert row; watch snapshots live in the conversation **storage context**; the activity cursor lives on the alert row.
- **DB:** no migration this session; the `alert_prompts.task_instance_id` column shipped in session 1 with NULL-pinned legacy rows (no backfill, by design).
- **Dependencies/modules:** none; no existing module needs replacing because no code is written.

### D5: Hook/TDD interactions

All files this session writes are markdown (`docs/`, `openspec/changes/`) — outside the TDD hook's scope, which is implementation files (`src/`, `client/`, `plugins/`, `review-loop/src/`, `sdd-runner/src/`, `.ts/.js` extensions); they pass through the pipeline untouched. Only the D3 defect path can touch `src/`, where the normal pipeline applies: write-policy gate (no inline suppressions), test-first advisory nudge, and targeted `bun test <file>` runs are the agent's responsibility. The doc-review stop hook will fire once at session end (advisory only).

## Risks / Trade-offs

- [Consolidated delta drifts from landed behavior] → each requirement is copied from a source delta and cross-checked against its module; anything unsourced is not written.
- [Source changes later archived, creating overlapping main specs] → accepted; this delta is self-contained and the overlap question is deferred (see Open Questions).
- [Docs edits creep beyond the named gaps] → `overview.md` no-op expectation recorded up front; every `behaviors.md` edit must cite the code line that justifies it.
- [A late defect forces code edits in a docs-only session] → D3 path: minimal test-first fix + full re-verification; shared-host rules (serial, ≥20 min timeout, one suite at a time) bound the cost.
- [Full-suite runtime on a loaded shared host] → single full run, query `reports/test/` artifacts (`test:failures`, `test:show`, `test:log`, `test:status`) instead of re-running.

## Migration Plan

Nothing to deploy or roll back beyond the commit itself: documentation and OpenSpec artifacts only, no schema or runtime change. Rollback = revert the commit.

## Open Questions

- When the three source changes are eventually handled, should they be archived as-is (three narrow main specs alongside `task-subscriptions`) or retired in favor of the consolidated capability? Deferrable to archive time; it does not affect this change's specs, approach, or tasks.

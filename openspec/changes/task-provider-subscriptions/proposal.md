# task-provider-subscriptions — Session 4: docs, spec delta, full verification

## Goal
Close out the task-provider-subscriptions effort. Sessions 1–3 landed as code+tests+their own changes — `pin-alerts-to-task-instances` (instance pin, cancel-on-switch/delete, poller routes by pin), `alert-task-watch` (`task.id` eq pure-watch, targeted getTask polling, snapshot-visible-change firing), `alert-activity-condition` (activity kind via getTaskHistory cursor, baseline-then-fire, activities.read gating, untrusted-content summaries) — all in `src/deferred-prompts/` with covering tests. This session: documentation completion, the consolidated OpenSpec delta, and full-repo verification. **No behavior changes; no webhooks; no refactors beyond what verification demands.**

## Files to touch
1. `docs/architecture/tools.md` — extend the `create_alert` block (line ~14) into a condition reference with concrete JSON examples for all three leaf shapes — field condition ({"field":"task.status","op":"changed_to","value":"Done"}), per-task watch ({"field":"task.id","op":"eq","value":"42"}), activity watch ({"kind":"activity","taskId":"TASK-1","categories":["comment"]}) — and document tool_prefs three-state behavior on create_alert specifically (deny removes it from the resolved set, ask wraps it in the _permission_reason per-call confirmation, allow is default; state create_alert's actual risk/domain class from src/tools/tool-metadata.ts). Keep precise, no fluff.
2. `docs/architecture/behaviors.md` — verify the three alert bullets (lines ~48–50: edge-triggering + pure-watch targeted polling; activity watches with cursor/baseline/cooldown-catch-up/capability-recheck; task-instance pinning with capture/evaluation/NULL-pin/auto-cancel/cancel-on-switch-and-delete) against the code; fill only genuinely missing pieces (cancel-on-switch/delete semantics, creation-refusal guidance, targeted-vs-whole-list polling) and fix inaccuracies.
3. `docs/architecture/overview.md` — check module-map/request-flow alert-polling lines; none exist beyond the accurate generic `src/index.ts` poller-start and deferred-tools mentions, so the expected outcome is a verified no-op — edit only an actually inaccurate line.
4. `specs/task-subscriptions/spec.md` in this change — consolidated delta covering: per-task watch creation+firing (eq-only validation, baseline cycle without firing, fire on snapshot-visible change, missing-task skip); activity firing gated on activities.read (creation refusal guidance when incapable/unconfigured/mixed trees, cursor baseline-then-edge advancing only after successful delivery, poll-time capability-loss skip, untrusted-content summaries); instance-pin cancel on switch/delete (capture at creation, evaluation against pinned instance, auto-cancel on unresolvable pin, cancel-on-switch scoped to the config context, cancel-before-delete across contexts); cooldown/dedup no-refire for all alert kinds; tool_prefs ask/deny on create_alert. Source of truth: the landed deltas under openspec/changes/{pin-alerts-to-task-instances,alert-task-watch,alert-activity-condition}/specs/ — consolidate, do not invent behavior.

## Intended behavior change
None — no runtime state, scope-model, platform-instance, or task-instance impact. Code is edited solely if verification surfaces a prior-session defect, and then minimally, followed by re-verification.

## Verification
1. `openspec validate task-provider-subscriptions --strict` — fix until clean.
2. Full-repo verification reading persisted report artifacts: `bun run test`, then typecheck/lint/format:check/`bun run check:full`. Shared-host rules per AGENTS.md; detail in design.md Risks. Deliverable: green checks, accurate docs, validated change.

## Non-goals
Archiving or retiring the three source changes (`pin-alerts-to-task-instances`, `alert-task-watch`, `alert-activity-condition`) — an operator action after this change lands. Any code, DB, dependency, or tool-surface change; webhook-based delivery; refactors.

## Capability
`task-subscriptions` — one consolidated spec for the landed alert/watch behavior (per-task watches, activity watches, instance pinning with cancel-on-switch/delete, shared cooldown/no-refire, `tool_prefs` gating on `create_alert`). Without it, sessions 1–3's behavior lives only in three separate change deltas with no single home for the cross-cutting cooldown and permission requirements, and `docs/architecture/tools.md` keeps only a stub where the condition reference now lives; nothing breaks at runtime — a consolidation, not new behavior.

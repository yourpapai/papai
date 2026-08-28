# Tasks — task-provider-subscriptions

## 1. OpenSpec delta

- [x] 1.1 Cross-check every requirement in `specs/task-subscriptions/spec.md` against its source delta (`openspec/changes/pin-alerts-to-task-instances/`, `alert-task-watch/`, `alert-activity-condition/` under `specs/`) and the covering tests under `tests/deferred-prompts/` and `tests/tools/create-alert.test.ts`; fix any drift, add no new behavior. Verify: `openspec validate task-provider-subscriptions --strict`

## 2. Documentation

- [x] 2.1 Extend the `create_alert` block in `docs/architecture/tools.md` (~line 14) into a condition reference with concrete JSON examples for all three leaf shapes — field condition (`{"field":"task.status","op":"changed_to","value":"Done"}`), per-task watch (`{"field":"task.id","op":"eq","value":"42"}`), activity watch (`{"kind":"activity","taskId":"TASK-1","categories":["comment"]}`) — pure-watch/pure-activity tree rules, and the targeted-vs-whole-list polling consequence. Verify: `rg -n 'task\.id|activity|changed_to' docs/architecture/tools.md`
- [x] 2.2 In the same reference, document `tool_prefs` three-state behavior on `create_alert` with its actual classification from `src/tools/tool-metadata.ts` (`write` risk, `deferred` domain, `create` operation): `deny` removes it from the resolved set, `ask` wraps each call in the `_permission_reason` per-call confirmation (refusal returns the structured `permission_denied` result), `allow` is the implicit default, and the `read-only` preset therefore resolves `create_alert` to `ask`. Verify: `rg -n 'create_alert: write' src/tools/tool-metadata.ts`
- [x] 2.3 Verify the three alert bullets in `docs/architecture/behaviors.md` (~lines 48–50) against `src/deferred-prompts/{poller-alerts,poller-alerts-watch,poller-alerts-activity,poller-alerts-grouping,activity-gating}.ts`; fill only the named gaps (cancel-on-switch/delete semantics, creation-refusal guidance for incapable/unconfigured/mixed trees, targeted-vs-whole-list polling) and fix any genuine inaccuracy. Verify: `bun test tests/deferred-prompts/poller-alerts.test.ts tests/deferred-prompts/poller-alerts-watch.test.ts tests/deferred-prompts/poller-alerts-activity.test.ts tests/deferred-prompts/activity-gating.test.ts`
- [x] 2.4 Check `docs/architecture/overview.md` module-map/request-flow lines for alert-polling accuracy — expected verified no-op (only the generic router/scheduler/poller and deferred-tools lines exist, both still accurate); edit only an actually inaccurate line. Verify: `rg -n 'deferred|poller' docs/architecture/overview.md`

## 3. Full verification

- [x] 3.1 Ensure client bundles exist (`bun run test` does not self-build): `bun build:client`
- [x] 3.2 If any check below surfaces a defect in prior sessions' code: write the failing test first, apply the minimal fix, re-run the affected file, then repeat 3.3–3.7; skip when everything is green. Verify: `bun test <affected test file>`
- [x] 3.3 Full suite, reading persisted artifacts for follow-ups instead of re-running: `bun run test` (failures via `bun run test:failures` and `bun run test:show <id>` against `reports/test/`)
- [x] 3.4 `bun run typecheck`
- [ ] 3.5 `bun run lint`
- [ ] 3.6 `bun run format:check`
- [ ] 3.7 `bun run check:full` (a failure names the log file under `reports/checks/` to open) — shared-host rules per AGENTS.md: never two full suites concurrently; if a shell timeout kills a run, consult `bun run test:status` / `test:log` before restarting
- [ ] 3.8 Final sweep: confirm the affected `docs/architecture/` pages (tasks 2.1–2.4) are updated and every check in 3.3–3.7 is green. Verify: `openspec validate task-provider-subscriptions --strict`

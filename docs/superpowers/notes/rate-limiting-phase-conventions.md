# Rate-limiting phase conventions

Companion to [`../specs/llm-rate-limiting-and-plans-phases.md`](../specs/llm-rate-limiting-and-plans-phases.md) and [`../../design/llm-rate-limiting-and-plans-phases.md`](../../design/llm-rate-limiting-and-plans-phases.md).

## How to use this document

- **Order matters.** Phases are bottom-up: storage and pure logic first, then
  wiring, then HTTP, then UI, then chat commands, then cleanup. Don't skip
  ahead — later phases assume earlier ones landed and are green.
- **Each phase has a stop line.** The "Exit criteria" section is the only
  thing that ends a phase. If `bun check:full` is red, the phase is not done,
  no matter how complete it feels.
- **One phase per commit / PR.** Keeps reviews tractable and lets the
  review-loop workspace bisect cleanly.
- **TDD is enforced by hooks** on `src/**` and `client/**`. Write the test
  first; the write-policy gate will reject implementation before a failing
  test exists. Phases below already follow that order.
- **Use `using-superpowers`, `writing-plans`, and `verification-before-completion`**
  skills around each phase as the project conventions require.

## Conventions used by every phase

| Field         | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| Touches       | Files created or modified. Numbers are illustrative; expect ±1.        |
| Depends on    | Phase numbers that must be merged first.                               |
| Tests         | Test files added (always added before implementation under TDD hooks). |
| Verification  | Exact commands run before declaring the phase done.                    |
| Exit criteria | Observable state when the phase is complete.                           |

Every phase ends with the same verification baseline (omitted from each phase
for brevity, run them anyway):

```bash
bun lint
bun typecheck
bun test            # curated main suite
bun format:check
```

`bun check:full` runs all of the above plus knip + duplicates and is the
required pre-merge gate.

## Per-phase session checklist

Use this as the checklist for any individual phase. The list is short on
purpose — the project's hooks and skills enforce the rest.

1. Read the spec section the phase implements. If unclear, open a
   question in chat **before** writing code.
2. Load the relevant superpower skills (`using-superpowers`,
   `test-driven-development`, `writing-plans`).
3. Write the failing test(s) listed under **Tests**. Run them, see them
   red.
4. Implement the smallest change that turns them green.
5. Run the baseline verification (`bun lint`, `bun typecheck`,
   `bun test`, `bun format:check`).
6. Run `bun check:full` before declaring done.
7. Commit on the same branch with a message matching the project's
   commit conventions (see `git log --oneline -20`).
8. Tick off the phase in this file's progress table below.

## Progress

> Update this table on merge of each phase.

| #   | Phase                                            | Status |
| --- | ------------------------------------------------ | ------ |
| 1   | Subject id helper                                | todo   |
| 2   | Quota types and constants                        | todo   |
| 3   | Window math                                      | todo   |
| 4   | DB migration: tables only                        | todo   |
| 5   | Seed migration                                   | todo   |
| 6   | Plan repository (read side)                      | todo   |
| 7   | Plan resolver                                    | todo   |
| 8   | Counter primitive: fixed_window increment        | todo   |
| 9   | Counter primitive: fixed_window refund/clamp     | todo   |
| 10  | Counter primitive: rolling_refill reserve+refund | todo   |
| 11  | `reserveQuota`                                   | todo   |
| 12  | `commitQuota`                                    | todo   |
| 13  | Audit writer                                     | todo   |
| 14  | Orchestrator pre-call gate (main role)           | todo   |
| 15  | Orchestrator commit hook                         | todo   |
| 16  | Small-role gate                                  | todo   |
| 17  | Tool wrapper gate                                | todo   |
| 18  | Web-fetch gate                                   | todo   |
| 19  | Proactive LLM gate (basic deny)                  | todo   |
| 20  | Deferred-prompt fallback chain                   | todo   |
| 21  | Embedding gate                                   | todo   |
| 22  | Attachment storage gate                          | todo   |
| 23  | Attachment reconciliation sweep                  | todo   |
| 24  | Threshold notice (80 %)                          | todo   |
| 25  | Garbage collector                                | todo   |
| 26  | `get_my_plan` tool                               | todo   |
| 27  | `get_my_quota` tool                              | todo   |
| 28  | `/plan` slash command                            | todo   |
| 29  | `/quota` slash command                           | todo   |
| 30  | `GET /admin/plans` and `GET /admin/plans/:id`    | todo   |
| 31  | `POST /admin/plans`                              | todo   |
| 32  | `PUT /admin/plans/:id`                           | todo   |
| 33  | `DELETE /admin/plans/:id`                        | todo   |
| 34  | `PUT /admin/subjects/:subjectId/plan`            | todo   |
| 35  | `DELETE /admin/subjects/:subjectId/plan`         | todo   |
| 36  | `GET /billing/subject/:subjectId/quota`          | todo   |
| 37  | `GET /admin/plans/audit`                         | todo   |
| 38  | Plans fetchers + types                           | todo   |
| 39  | `PlansPanel.svelte`                              | todo   |
| 40  | `PlanEditor.svelte` create flow                  | todo   |
| 41  | `PlanEditor.svelte` edit + delete flow           | todo   |
| 42  | Subjects table: Plan column                      | todo   |
| 43  | Subjects table: Quota column                     | todo   |
| 44  | Subject Detail: Quota card                       | todo   |
| 45  | Audit log viewer                                 | todo   |
| 46  | `/plans` admin command                           | todo   |
| 47  | `/setplan` admin command                         | todo   |
| 48  | Stop writing to `web_rate_limit`                 | todo   |
| 49  | Drop `web_rate_limit` migration                  | todo   |

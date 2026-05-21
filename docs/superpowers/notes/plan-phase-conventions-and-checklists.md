# Dashboard/Admin Split Plan — Phase Conventions and Checklists

Extracted from [`../../design/dashboard-admin-split-plan.md`](../../design/dashboard-admin-split-plan.md).

## Conventions used by every phase

| Field         | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| Goal          | One-sentence summary of the phase outcome.                             |
| Touches       | Files created or modified. Numbers are illustrative; expect ±1.        |
| Depends on    | Phase numbers that must be merged first.                               |
| Tests         | Test files added (always added before implementation under TDD hooks). |
| Exit criteria | Observable state when the phase is complete.                           |

## Cross-cutting checklist

Before each PR is opened:

- [ ] Branch is `claude/split-dashboard-admin-zaoys`.
- [ ] `bun lint` + `bun typecheck` + `bun test` + `bun test:client` +
      `bun format:check` + `bun build:client` all green.
- [ ] No new admin route added without the central
      `isAuthorizedRequest()` gate (grep
      `src/debug/server.ts` for `/admin/` after the diff).
- [ ] No new ungated **write** route on any path.
- [ ] No `eslint-disable`, `oxlint-disable`, `@ts-ignore`,
      `@ts-nocheck`, or `.oxlintrc.json` edits (hooks block them
      anyway; double-check before pushing).
- [ ] Tests for any new component live at the mirrored path under
      `tests/client/{debug,admin,shared}/`.
- [ ] If a panel is moved, the **old import path is gone** in the same
      commit — don't leave a re-export shim behind.

## Rollback plan

If a phase wedges the tree:

- Phases 1-3 are additive; revert the phase commit only.
- Phase 4 + 5 + 6 cluster — these together move /dashboard to /debug.
  If a regression escapes, revert all three commits in order (6 → 5 →
  4). The 301 redirect lets stale links keep working post-revert.
- Phases 7-11 are per-section; reverting one phase only loses that
  section, leaving /admin shell + earlier sections intact.
- Phases 12-14 are cleanup; reverting them never affects functionality.

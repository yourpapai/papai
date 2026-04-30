# Remaining Work: 2026 04 14 youtrack tool parity checklist

**Status:** partially_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-14-youtrack-tool-parity-checklist.md`

## Completed

- Decision to not add a separate `get_task_summary` tool as `get_task` is sufficient.
- Verification of current single-task read path coverage in tests.

## Remaining

- Phase 1: Fix YouTrack due date support (mappers, constants, operations/tasks.ts).
- Phase 1: Fix attachment tool builder context bug (tools-builder.ts).
- Phase 1: Implement honest custom-field support (domain-types.ts, mappers.ts, tools/get-task.ts, etc.).
- Phase 2: Expose `get_project` and `get_current_user` tools.
- Phase 3: Relax priority schema restrictions in shared task tools.
- Phase 3: Add name-based tag convenience for labels.
- Phase 3: Add pagination knobs to read-heavy tools (comments, work items, etc.).
- Phase 4: Evaluate promotion of provider-only features (count_tasks, sprints, etc.).

## Suggested Next Steps

1. Implement Phase 1, Item 1: Fix YouTrack due date support end-to-end.
2. Implement Phase 1, Item 2: Fix the attachment tool builder context bug.
3. Implement Phase 1, Item 3: Make custom-field support honest and minimally correct.

## Context

See proposal.md Why. Copy (`copyCensorIntervalsIn`, `src/analytics/rekey/copy-children.ts:212`) gates on `inSource` (actor has a source parent event); verify (`src/analytics/rekey/verify-content.ts:100`) classifies by actor-key prefix. After withdraw+delete (0 events, 1 `v1` censor) copy writes 0 targets while verify demands 1. Equation is unaffected (no parents). Run `rekey-mtmprpzl-62cf132a-0` is paused holding the slot; the fix is proven on a successor run.

## Goals / Non-Goals

**Goals:**
- Orphan censor intervals remap 1:1 like every other child table; zero-event state rekeys green.
- Copy stays idempotent (`exists` guard retained); no new tables, migrations, or key material.

**Non-Goals:**
- No fence-admission change for censor writers; no abort-policy change; no snapshot-remount work.

## Decisions

- **Remove the `inSource` guard** (copy all source intervals remapped) over scoping verify down: censor intervals are subject-rights evidence that must outlive their events (withdrawal markers post-delete), and verify already treats them as actor-scoped, so copy is the inconsistent side.
- **No backfill/migration:** shadow rows are derived at copy time; existing source rows untouched.
- **TDD order:** regression test first (`tests/analytics/rekey/copy-children.test.ts` + verify-content coverage), then the one-line copy fix, then `bun test tests/analytics/rekey`, typecheck/lint. New/changed files fall under the Write/Edit TDD hook pipeline and the per-file mutation ratchet.

## Risks / Trade-offs

- [Risk: source-event lookup removal hides a different orphan class] → Mitigation: verify's exact 1:1 comparison still fails on extras/missing; regression test covers both mixed and zero-event states.
- [Risk: stuck run still holds the slot] → Mitigation: successor run proves the fix; stuck run remains paused evidence, never hand-edited.

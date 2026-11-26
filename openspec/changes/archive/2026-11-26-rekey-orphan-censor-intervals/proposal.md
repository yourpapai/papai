## Why

Planned rekey `rekey-mtmprpzl-62cf132a-0` (gen-1→gen-2, Stage C drill 2026-09-04) is stuck `paused`: `verify` reports `equation_ok=true content_ok=false mismatches=["censor_intervals"]` on every resume. The withdraw+delete drill left 0 live `analytics_events` with a surviving `v1` censor interval, a state copy can never satisfy. Without the fix no rekey can complete from a fully-withdrawn pilot, and the single-nonterminal run slot stays held.

## What Changes

- `copyCensorIntervalsIn` copies every source censor interval remapped to the target actor key, including actors with no source parent event (remove the `inSource` guard).
- No change to parent copy, equation verify, run-slot or fence semantics.
- Add regression coverage: withdraw→delete (0 events + 1 censor) → plan→apply→verify green.

## Capabilities

### New Capabilities

- `analytics-rekey`: rekey child-copy and content-verify contract for censor intervals, including the zero-parent-event (fully withdrawn/deleted) state.

Without it, any rekey planned after a complete withdrawal/deletion deterministically pauses at `verify.local_graph` and blocks the run slot; Stage C exit (planned-rekey drill) stays red.

### Modified Capabilities

None — no existing `openspec/specs/` capability covers analytics rekey; behavior change is scoped to the new capability above.

## Impact

- Code: `src/analytics/rekey/copy-children.ts` (`copyCensorIntervalsIn`), tests under `tests/analytics/rekey/`.
- Docs: Stage C evidence `docs/research/analytics-metrics/11-stage-c-evidence.md` (drill unblocked on a successor run); no `docs/architecture/*.md` behavior change.
- Scope model: per-actor censor data (per-user), no platform/task-instance or thread/group impact.

## Non-goals

- No change to parent event copy, shadow equation, dual-write domains, or fence admission for censor writers (a separate change if live censor writes during copy prove racy).
- No abort-policy change for the stuck run: it stays `paused` as evidence; the fix is proven on a successor run, not by hand-editing shadow rows.
- No deletion-ack snapshot-remount work (separately blocked).

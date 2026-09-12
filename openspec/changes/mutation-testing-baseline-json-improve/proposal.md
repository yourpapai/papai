## Why

`scripts/mutation/baseline.json` records one number per file — the aggregate killed/scored mutation ratio — and the PR ratchet fails any baselined file whose ratio drops below its floor (`resolveRatchet`, `scripts/mutation/baseline.ts`). Adding new functionality to a file lowers that ratio even when every old test still kills every old mutant: the new, not-yet-fully-tested code grows the denominator with survivors, so the gate reports a "regression" that weakened nothing. The ratchet cannot distinguish real test weakening (kills dropped) from new-code dilution (kills held, population grew), so it blocks legitimate feature work on well-baselined files and rewards gaming the ratio with throwaway assertions.

## What Changes

- Record multiple values per baseline entry instead of a single ratio: the score plus the absolute kill/population counts behind it, so a run can be compared against what was actually achieved before, not just a percentage.
- Reshape the ratchet verdict (`scripts/mutation/gates.ts`): a true regression — killing power dropped against the recorded population — still fails the PR; new-code dilution — kills held while the mutant population grew — surfaces as a visible warning instead of failing the gate.
- Keep the ratchet monotonic and the seeding contract intact: `seedMerge`/`ratchetMerge` stay per-key max, seeding stays fresh-measurement-only, floors only ever tighten.
- Migrate `scripts/mutation/baseline.json` to the richer shape (one-time reseed vs dual-shape read decided in design) and update the `mutation-improve` runner's baseline reader/summary, which parses the same file.
- Update `scripts/mutation/README.md`, `docs/architecture/commands.md`, and the AGENTS.md testing note; record the new verdict rule in an ADR extending ADR-0342.

## Capabilities

### New Capabilities

None. The baseline exists only as the PR gate's floor; that behavior is already owned by the `mutation-gate` capability (`openspec/specs/mutation-gate/spec.md`), so this change extends that spec rather than introducing a sibling capability.

### Modified Capabilities

- `mutation-gate`: the ratchet requirement changes from "a baselined file fails when its score falls below its recorded ratio" to a verdict that distinguishes true regression from new-code dilution, and the committed-baseline requirements now specify which values a baseline record must carry. Without this, any PR adding functionality to a baselined file can fail the gate without weakening a single existing test — a false positive of exactly the kind the gate exists to prevent.

## Non-goals

- Per-region / line-range baselines — brittle against formatting and refactor churn; declined.
- Mutant-id-level floors (surviving-id sets in `baseline.json`) — `mutation-improve` already set-matches declared residuals where that precision matters; too heavy for the PR gate.
- Quality floors on new code (blocking first-touch or dilution outright) — the gate stays a pure regression ratchet per ADR-0342; dilution is surfaced, never failed.
- Test-set resolution, fingerprinting, or incremental score reuse (ADR-0424) — orthogonal and unchanged.
- Changing Stryker's score formula `(killed + timeout) / scored` — the measurement definition stays; only what the baseline records and how it is judged changes.

## Impact

- **Runtime scope**: none — CI/tooling only; no platform or task instances, and no config-context state (per-user, group-shared, or thread-isolated) is touched.
- **Code**: `scripts/mutation/baseline.ts` (`BaselineMap`, `resolveRatchet`, `seedMerge`/`ratchetMerge`), `scripts/mutation/gates.ts` (regression message + warnings channel), `scripts/mutation/changed-files.ts` (WARN printing), `scripts/mutation/seed-from.ts` (record-aware snapshot), `scripts/mutation/baseline.json` (migrated), `mutation-improve/src/baseline.ts` (shape-aware reader/record-level bump), `mutation-improve/src/score-reader.ts` (`MeasuredScore` carries the measured counts beside the score), `mutation-improve/src/gate.ts` (`GateOutcome` carries them), `mutation-improve/src/pipeline.ts` + `skip-ratchet.ts` (bump call sites pass the counts), and `mutation-improve/src/prompt-templates.ts` (SELECT prompt describes the record shape — the runner's only baseline rendering). The score cache (`reports/paired/score-cache.json`) already stores full per-file counts and needs no change.
- **CI**: the `.github/workflows/ci.yml` mutation jobs keep their shape (changed-files gate + master seed); only the seed's record shape changes.
- **Docs/specs**: delta on `openspec/specs/mutation-gate/spec.md`; `scripts/mutation/README.md`, `docs/architecture/commands.md`, AGENTS.md Testing Notes; new ADR extending ADR-0342 and referencing ADR-0424.

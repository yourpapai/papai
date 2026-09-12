# mutation-gate Specification

## Purpose

Defines the per-file mutation PR gate's coverage contract: which files it evaluates, when it may
reuse a score measured by an earlier run instead of re-measuring, and what it must never let
pass. The gate evaluates the whole branch against master while measuring only what changed since
the previous run.

## Requirements

### Requirement: Whole-branch gate coverage

The gate SHALL evaluate every gateable file in the branch diff against the base branch on every
run, regardless of which files that run actually measured. A file's score SHALL come from this
run's measurement when it was measured, and otherwise from a carried-over score recorded by an
earlier run on the same branch. A file in the branch diff for which neither exists SHALL be
measured.

#### Scenario: A regression from an earlier commit keeps failing

- **WHEN** commit A drops file `X` below its recorded baseline, and commit B changes only an
  unrelated file `Y` whose score is fine
- **THEN** the run for commit B measures only `Y`, still evaluates both `X` and `Y`, and exits
  non-zero naming `X` with its carried-over score and its baseline floor

#### Scenario: A file reverted to the base branch's content leaves the gate

- **WHEN** a file's content is restored to match the base branch
- **THEN** it is absent from the branch diff and is neither measured nor gated

#### Scenario: No carried-over scores available

- **WHEN** no earlier run's scores can be recovered (first run on the branch, or the store was
  evicted)
- **THEN** every file in the branch diff is measured, and the gate's verdict is unchanged from
  measuring everything

### Requirement: Fingerprint-guarded score reuse

A carried-over score SHALL be consumed only when its fingerprint exactly matches a fingerprint
recomputed from current state. The fingerprint SHALL cover the source file's contents, the paths
and contents of its candidate test set, and a toolchain hash over the Stryker configuration,
the test-set overrides, the lockfile, the mutation scripts and the mutation runner versions. It
SHALL NOT depend on file modification times, absolute paths, commit identifiers, or the recorded
baseline. Any mismatch SHALL cause the file to be re-measured.

#### Scenario: Unchanged file reuses its score

- **WHEN** a file in the branch diff, its candidate tests and the toolchain are all byte-identical
  to when a carried-over score was recorded
- **THEN** that score is reused and the file is not re-measured

#### Scenario: A weakened test forces re-measurement

- **WHEN** a test in a file's candidate test set is edited, added or removed
- **THEN** that file's fingerprint changes and the file is re-measured

#### Scenario: A toolchain change invalidates every carried-over score

- **WHEN** the Stryker configuration, the overrides file, the lockfile, or any mutation script
  changes
- **THEN** no carried-over score matches and every file in the branch diff is re-measured

#### Scenario: A fresh checkout still matches

- **WHEN** the same content is checked out again on a different machine, so every file
  modification time differs
- **THEN** the fingerprints are identical and carried-over scores are still reused

#### Scenario: A raised baseline is enforced against a carried-over score

- **WHEN** the recorded baseline for a file rises after its score was carried over
- **THEN** the carried-over score is compared against the new, higher floor and fails if it is
  below it

### Requirement: Unmeasurable outcomes are never carried over

The gate SHALL NOT record a carried-over score for a file whose mutation run errored or which
was skipped for lack of a test set. Such files SHALL be re-measured on the next run, and an
errored file SHALL continue to fail the gate.

#### Scenario: An errored file is retried, not remembered

- **WHEN** a file's Stryker run fails before producing a report
- **THEN** the run exits non-zero naming that file, nothing is recorded for it, and the next run
  measures it again rather than reusing anything

#### Scenario: Scores survive a failing run

- **WHEN** a run measures several files and then fails the gate
- **THEN** the scores it measured are still recorded, so the next run does not re-measure them

### Requirement: The committed baseline is seeded only from fresh measurements

Baseline seeding SHALL disable score reuse entirely, so no carried-over score can become a
recorded floor. Operators SHALL be able to disable reuse for any run.

#### Scenario: Master seeding measures fresh

- **WHEN** the baseline seed runs after a merge to the base branch
- **THEN** every file it seeds was measured in that run, and no carried-over score contributes

#### Scenario: Operator forces a full re-measure

- **WHEN** a run is invoked with reuse disabled
- **THEN** every file in the branch diff is measured even where a matching carried-over score
  exists

### Requirement: Auditable measured-versus-reused reporting

Each run SHALL report the size of the whole-branch target set, which files it measured, and
which files it reused — with each reused file's score and when it was measured — before the gate
verdict, so a green run cannot be mistaken for a partial one.

#### Scenario: The run summary distinguishes measured from reused

- **WHEN** a run measures 3 of 22 branch-diff files and reuses 19
- **THEN** it reports all three counts and lists each reused file with its score and measurement
  time before reporting the verdict

### Requirement: Coding-agent workspace product code is gated

The gate's mutate scope SHALL include every TypeScript product source file under the
coding-agent workspace's source tree (`opencode-agent/src/`), excluding barrel `index.ts` and
`constants.ts` modules under it in the same way the other gated trees exclude theirs. Every
selection surface that derives the gate's targets — the local changed-file selection and the
staged dispatch behind the plan/shard/gate CI pipeline — SHALL route those paths, so a branch
whose only product-code changes live in the workspace is measured and gated like any other
branch instead of passing with zero targets.

#### Scenario: A workspace-only product change is measured

- **WHEN** a branch's only product-code changes are TypeScript files under `opencode-agent/src/`
- **THEN** both the local changed-file selection and the CI staged dispatch select those files,
  the run measures them, and the gate judges their scores instead of passing as a zero-target run

#### Scenario: Excluded workspace modules stay out of scope

- **WHEN** a branch's changes under `opencode-agent/src/` touch only barrel `index.ts` or
  `constants.ts` modules
- **THEN** those files are not measured, matching the same exclusions applied in the other gated
  trees

#### Scenario: Workspace non-source files are not product code

- **WHEN** a branch touches only workspace files outside the source tree (documentation,
  workflow configuration)
- **THEN** the gate selects no targets from them

### Requirement: Source-test mapping covers the coding-agent workspace

The source-to-test mapping SHALL resolve `opencode-agent/src/x.ts` to the shared tests tree at
`tests/opencode-agent/x.test.ts`. Back-resolution SHALL search the workspace's source subtree for
the test file's basename and resolve the unique existing match; a test whose basename matches no
existing source file, or several, SHALL resolve no implementation counterpart on any consuming
surface — never a nonexistent path. Every surface that consumes the mapping — candidate test-set
resolution for measurement, fingerprint computation, and the write-hook test resolution — SHALL
agree on that convention, so that where a counterpart exists every surface resolves the identical
pair, and where it does not every surface resolves none, keeping the workspace's candidate test
sets and score fingerprints computed from the same source-test pairs.

#### Scenario: A workspace source file has a candidate test set

- **WHEN** a workspace product file with a mapped test file under `tests/opencode-agent/` is
  selected for measurement
- **THEN** its candidate test set contains that test file, and it is measured rather than skipped
  for lack of a test set

#### Scenario: Editing a workspace test forces re-measurement

- **WHEN** a test file under `tests/opencode-agent/` is edited, added, or removed
- **THEN** the mapped workspace source file's fingerprint changes and the file is re-measured on
  the next run

#### Scenario: The write hook resolves the same pair

- **WHEN** the write-hook pipeline resolves the test counterpart of a workspace source file, or
  the implementation counterpart of a workspace test file
- **THEN** it resolves the same mapped pair the mutation gate uses, and a workspace test with no
  unique existing namesake resolves no counterpart on any surface (the write hook skips, as it
  does for every gated tree) instead of a nonexistent path

### Requirement: Newly covered files are floored before their first gated change

When the gate's scope is widened, the committed baseline SHALL record a per-file floor for every
newly covered file from one full seeding run that measures the entire newly added scope fresh,
with no carried-over score contributing. The floors SHALL be committed before the widened scope
gates any change, and SHALL be recorded as measured, so the monotonic ratchet covers the new
files from their first measured change.

#### Scenario: The first gated change is judged against seeded floors

- **WHEN** the first branch gated after the scope lands touches only workspace product files and
  drops one of them below its recorded floor
- **THEN** the gate fails naming that file with its score and the floor recorded by the seeding
  run

#### Scenario: Seeding covers the whole newly added scope

- **WHEN** the seeding run for the widened scope completes
- **THEN** every newly covered product file has a floor recorded from that run's fresh
  measurement

#### Scenario: A file without a recorded floor is never a free pass

- **WHEN** a gated branch includes a workspace product file for which no floor was recorded (for
  example, a file created in the workspace after seeding)
- **THEN** the file is measured by that run and judged by the gate's rules for files without a
  recorded floor — it is never passed for lack of measurement

### Requirement: The shell check's workspace enumeration routes gated source trees

The staged shell check's workspace-scoped enumerations SHALL route the coding-agent workspace's
source tree, and SHALL at all times continue to route every source tree that is both gateable
product code for the mutation gate and routed by the staged enumerations, so the check pipeline
and the mutation gate cannot newly disagree about which workspaces ship product code. Gateable
source trees the staged enumerations do not route (`plugins/` and `afk-runner/src/` today) are a
pre-existing divergence recorded in the change's design — this requirement does not obligate
extending the enumerations to them, and repairing that divergence is a deliberate, separate act
that updates both the shell arms and the pin's recorded set together.

#### Scenario: A staged workspace source file reaches the workspace-scoped checks

- **WHEN** a staged change includes a file under `opencode-agent/src/`
- **THEN** the shell check's workspace-scoped staged checks enumerate and process it

#### Scenario: The enumeration and the gate scope agree

- **WHEN** a source tree is gateable product code for the mutation gate and is routed by the
  staged shell check's workspace-scoped enumerations
- **THEN** both workspace-scoped enumerations route that tree's source paths, and a change to
  either surface's set of such trees fails the agreement pin instead of diverging silently

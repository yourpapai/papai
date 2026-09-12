## ADDED Requirements

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

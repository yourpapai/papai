# mutation-gate Specification — Delta

## ADDED Requirements

### Requirement: The ratchet distinguishes true regression from new-code dilution

The per-file ratchet SHALL judge a baselined file against the record's absolute outcome, not its
ratio alone. A measurement "kills" the mutants the score formula counts as killed; its
"population" is its scored mutants. A baselined file SHALL fail the gate only when its
measurement both scores below the recorded score and kills fewer mutants than the record — a
true regression, meaning killing power dropped. When its score falls below the recorded score
while it kills at least as many mutants as the record — kills held while the mutant population
grew, which is new-code dilution — the file SHALL NOT fail the gate; the run SHALL surface a
visible warning naming the file instead. A measurement whose score is at or above the recorded
score SHALL pass without a dilution warning. A file with no baseline entry SHALL be neither
failed nor warned by the ratchet.

#### Scenario: Weakened tests fail the gate

- **WHEN** a baselined file's measurement scores below its recorded score and kills fewer
  mutants than the record
- **THEN** the run exits non-zero naming the file with its measured score and kill count
  against the recorded ones

#### Scenario: New-code dilution warns instead of failing

- **WHEN** a baselined file's measurement kills at least as many mutants as its record but
  scores below the recorded score because its mutant population grew
- **THEN** the run exits zero — provided no other gate fails — and its output contains a
  warning naming the file, its held kill count, and both scores

#### Scenario: A shrunken population that holds the score raises no warning

- **WHEN** a baselined file's measurement scores at or above its recorded score, even though it
  kills fewer mutants than the record because its population shrank
- **THEN** the file passes and no dilution warning names it

#### Scenario: A first-touch file is untouched by the ratchet

- **WHEN** a changed file has no baseline entry
- **THEN** the ratchet neither fails it nor emits a dilution warning for it

### Requirement: Committed baseline records carry the counts behind their scores

Each committed baseline entry SHALL record, together with the file's mutation score, the
absolute counts that produced it: the scored-mutant population and the killed count the score
was computed from. A record's counts SHALL belong to the same measurement as its score — a
record SHALL NOT pair a score from one measurement with counts from another. The PR gate's
ratchet and the improvement runner SHALL read the same committed file and interpret each record
identically, and the improvement runner's selection, ratchet bumps, and run summaries SHALL keep
working against the richer record, with a bump writing counts that match the measurement it
records.

#### Scenario: A seeded record is complete

- **WHEN** the baseline seed records a file measured at a given score from a given killed and
  scored count
- **THEN** the committed entry for that file carries that score and those counts together

#### Scenario: The improvement runner keeps working on the richer baseline

- **WHEN** the improvement runner selects a file from the baseline and later ratchets a
  measured score for it
- **THEN** selection, the ratchet bump, and the run summary succeed, and the bumped entry
  carries counts matching the measurement it recorded

#### Scenario: Consumers interpret records identically

- **WHEN** the PR gate and the improvement runner read the same committed baseline
- **THEN** both derive the same score floor and the same counts for every record

### Requirement: A record without counts is judged by score alone

A committed entry that carries a score without counts (the previous single-number shape) SHALL
remain an enforceable floor: the ratchet SHALL fail the file when its score falls below the
recorded score and SHALL pass it otherwise, without classifying dilution — such a record cannot
distinguish a true regression from dilution, so it keeps the stricter, score-only judgment until
the file is next measured at or above its recorded score and its record gains counts.

#### Scenario: A score-only record still enforces its floor

- **WHEN** a baselined file's record carries no counts and its measurement scores below the
  recorded score
- **THEN** the run exits non-zero naming the file against its recorded floor

#### Scenario: A score-only record gains counts when next baselined

- **WHEN** a file with a score-only record is measured again at or above its recorded score by a
  run that updates the baseline
- **THEN** its committed entry is written back as a complete record — score plus counts — from
  that measurement

### Requirement: Baseline floors only tighten

Baseline updates SHALL be monotonic per file: a recorded score SHALL only ever be replaced by a
strictly higher score, with the counts of the measurement that achieved it. A measurement that
does not exceed a file's recorded score SHALL leave the recorded score unchanged, and a complete
record's counts unchanged with it — the single exception being a score-only record measured at
exactly its recorded score, which SHALL gain that measurement's counts and become a complete
record at the unchanged floor (a shape upgrade, not a floor change). A measurement that exceeds
a recorded score SHALL replace the record wholesale with the new score and its counts.

#### Scenario: A weaker measurement never lowers a floor

- **WHEN** a baseline update merges a measurement whose score for a file is below the file's
  recorded score, or equal to it over an already-complete record
- **THEN** the committed record is unchanged, score and counts alike

#### Scenario: A stronger measurement tightens the floor as one unit

- **WHEN** a baseline update merges a measurement whose score for a file exceeds the recorded
  score
- **THEN** the committed record carries the new score together with that measurement's counts,
  never a mix of old and new

## MODIFIED Requirements

### Requirement: Whole-branch gate coverage

The gate SHALL evaluate every gateable file in the branch diff against the base branch on every
run, regardless of which files that run actually measured. A file's score SHALL come from this
run's measurement when it was measured, and otherwise from a carried-over score recorded by an
earlier run on the same branch. A file in the branch diff for which neither exists SHALL be
measured.

#### Scenario: A regression from an earlier commit keeps failing

- **WHEN** commit A weakens file `X`'s tests so its run scores below the recorded floor and
  kills fewer mutants than the baseline records, and commit B changes only an unrelated file
  `Y` whose score is fine
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
- **THEN** the carried-over outcome is judged against the new, higher floor by the same ratchet
  verdict as a fresh measurement, and fails if it regresses against that floor

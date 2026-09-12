## ADDED Requirements

### Requirement: Lens merge integrity

When the reviewer and skeptic lenses run in the same round, the pipeline SHALL merge their findings by a normalized gap fingerprint (case-insensitive, punctuation- and whitespace-insensitive token comparison) rather than exact text equality, and the merged finding SHALL carry the most severe class among its copies. Skeptic finding ids SHALL be namespaced (prefix `S`, e.g. `S1`) so lens id spaces cannot collide. A round's resolver output SHALL contain at most one resolution per finding id; duplicates SHALL fail sidecar validation.

#### Scenario: Differently-quoted duplicate gaps merge to one finding

- **WHEN** the skeptic quotes the same gap as the reviewer with different wording that normalizes to the same fingerprint
- **THEN** the merged round finding list SHALL contain one finding for the pair, carrying the more severe of the two classes

#### Scenario: Duplicate resolution ids fail validation

- **WHEN** a resolver sidecar contains two resolutions with the same finding id
- **THEN** sidecar validation SHALL fail and the spawn SHALL retry with the validation error appended, as any schema failure does

### Requirement: Convergence counts distinct findings

The convergence predicate SHALL count distinct merged findings per class, never duplicate copies of the same finding or the same concern, so a round's verdict is invariant to how many lenses quoted a gap.

#### Scenario: Nitpick pair does not double-count

- **WHEN** a round's merged findings contain one distinct nitpick quoted by both lenses
- **THEN** the convergence counts SHALL include that nitpick exactly once

### Requirement: Round-tagged known-concerns ledger

Ledger lines rendered into reviewer prompts SHALL carry the round that produced each resolution (`r3 [F2] MATERIAL edited — …`) and SHALL be rendered as a per-concern digest capped in size, each line naming the concern's fingerprint, its last-seen round, and its latest outcome, so a fresh reviewer can recognize a known concern regardless of wording.

#### Scenario: Re-raised known concern is recognizable

- **WHEN** a reviewer in round N encounters artifact text matching a concern whose digest line says resolved in round N−3
- **THEN** the prompt SHALL have presented that concern in the digest with its round tag and outcome, and the reviewer instructions SHALL direct re-raising only with new evidence

### Requirement: Concern-cluster thrash detection gates with history

The pipeline SHALL track finding fingerprints across rounds within a run. When a concern that was resolved or dismissed in at least two prior rounds is raised again, or when the same concern's class oscillates between rounds, the pipeline SHALL present a gate that lists the recurring concerns each with its full round-by-round history (round, class, resolution, outcome) and SHALL NOT silently continue the loop with another ordinary round.

#### Scenario: Third strike presents the concern history

- **WHEN** a concern resolved in rounds 2 and 5 is raised again in round 7
- **THEN** the round's gate SHALL include a concern-history section naming the concern with its rounds 2, 5, and 7 entries, and the pipeline SHALL await a human decision before further review spend

#### Scenario: Oscillating class triggers the same gate

- **WHEN** the same concern fingerprint is classified MATERIAL in one round and BLOCKER in a later round after having been resolved
- **THEN** the gate SHALL present the concern's oscillation history

### Requirement: Cross-artifact consistency check at round close

At each round's materialization, the pipeline SHALL run a consistency check over the change folder's proposal, design, and spec files for the same decision term rendered differently across artifacts (migration strategy, schedule interval, naming, or mechanism references), and any disagreement SHALL surface as a MATERIAL finding naming both files and both renderings before the next reviewer round runs.

#### Scenario: Proposal and spec disagree on migration strategy

- **WHEN** the proposal names a drizzle migration and the spec's requirement names a hand-written migration for the same storage
- **THEN** the next round SHALL open with a MATERIAL finding quoting both renderings and naming both files

#### Scenario: Consistent artifacts add no finding

- **WHEN** all artifacts render every shared decision term identically
- **THEN** the consistency check SHALL add no findings

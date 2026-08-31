## ADDED Requirements

### Requirement: Lens merge integrity

When the reviewer and skeptic lenses run in the same round, the pipeline SHALL merge their findings by a normalized gap fingerprint (case-insensitive, punctuation- and whitespace-insensitive token comparison) rather than exact text equality, and a merged finding SHALL carry the most severe class among its copies. Skeptic finding ids SHALL be namespaced (prefix `S`) so lens id spaces cannot collide. A round's resolver output SHALL contain at most one resolution per finding id; duplicates SHALL fail sidecar validation.

#### Scenario: Differently-quoted duplicate gaps merge to one finding

- **WHEN** the skeptic quotes the same gap as the reviewer with wording that normalizes to the same fingerprint
- **THEN** the merged round finding list SHALL contain one finding for the pair, carrying the more severe of the two classes

#### Scenario: Duplicate resolution ids fail validation

- **WHEN** a resolver sidecar contains two resolutions with the same finding id
- **THEN** sidecar validation SHALL fail and the spawn SHALL retry with the validation error appended, as any schema failure does

### Requirement: Convergence counts distinct findings

A round's convergence counts SHALL be computed over distinct merged findings per class, never duplicate copies of the same gap or the same concern, so the verdict and both count sets (raised and open) are invariant to how many lenses quoted a gap.

#### Scenario: Nitpick pair does not double-count

- **WHEN** a round's merged findings contain one distinct nitpick quoted by both lenses
- **THEN** the round's raised and open counts SHALL include that nitpick exactly once

### Requirement: Round-tagged known-concerns ledger

Ledger lines rendered into reviewer prompts SHALL carry the round that produced each resolution (`r3 [F2] MATERIAL edited — …`) and SHALL be rendered as a per-concern digest capped in size — one line per concern naming its last-seen round, its class and resolution, and the span of rounds it has been seen in — so a fresh reviewer can recognize a known concern regardless of wording. Concerns older than the cap SHALL collapse into a single overflow note.

#### Scenario: Re-raised known concern is recognizable

- **WHEN** a reviewer in round N encounters artifact text matching a concern whose digest line says it was resolved in round N−3
- **THEN** the prompt SHALL have presented that concern in the digest with its round tag and outcome, and the reviewer instructions SHALL direct re-raising only with new evidence

### Requirement: Concern-cluster thrash detection ends the loop with history

The pipeline SHALL track finding fingerprints across rounds within a run. When a concern with at least two prior resolved or dismissed entries is raised again, or a re-raised concern's class differs from a prior resolution's class, the round loop SHALL end instead of running another ordinary round, and the run SHALL NOT buy the verification round such a cap-hit would otherwise owe. When a gate is presented after a thrash end, its text SHALL include a concern-history section listing each recurring concern with its full round-by-round history (round, class, resolution, outcome); a thrash end whose open set is nitpicks only SHALL still flow to the tail without a gate.

#### Scenario: Third strike ends the loop with history

- **WHEN** a concern resolved in rounds 2 and 5 is raised again in round 7
- **THEN** the loop SHALL end at round 7, the round's convergence event SHALL carry the concern's cluster id, and any presented gate SHALL include a concern-history section naming the concern with its rounds 2, 5, and 7 entries

#### Scenario: Oscillating class triggers the same end

- **WHEN** the same concern fingerprint is resolved at MATERIAL in one round and re-raised as BLOCKER in a later round
- **THEN** the loop SHALL end and the concern's oscillation history SHALL ride the run's presentation

#### Scenario: Thrash end denies the verification round

- **WHEN** a loop ends on thrash carrying a verdict that would otherwise owe one verification round
- **THEN** no verification round SHALL run and the open set alone SHALL decide gate versus tail

### Requirement: Cross-artifact consistency check at round close

At each round's materialization the pipeline SHALL run a deterministic consistency check over the change folder's proposal, design, and spec files for the same decision term rendered differently across artifacts, and any disagreement SHALL surface as a MATERIAL finding naming both files and both renderings in the next round's findings.

#### Scenario: Proposal and spec disagree on migration strategy

- **WHEN** the proposal names a drizzle migration and a spec requirement names a hand-written migration for the same storage
- **THEN** the next round's findings SHALL include a MATERIAL finding quoting both renderings and naming both files

#### Scenario: Consistent artifacts add no finding

- **WHEN** all artifacts render every shared decision term identically
- **THEN** the consistency check SHALL add no findings

# afk-runner-pipeline Specification

## Purpose

Defines the run pipeline afk-runner drives end to end — stage sequence by depth, gates, review rounds, and event-sourced state — so every run ends at a park with replayable history.

## Requirements

### Requirement: Stage sequence through the tail

The pipeline SHALL drive a run through intake, draft, the review loop, and a
tail — task decomposition, atomicity checking on depth M/L, and a final gate —
and SHALL end every run at a park: `completed` via final-gate approval or
`aborted` via abort. A depth-S run SHALL skip the atomicity stage, with
decomposition presenting the final gate as its last work act. No completion
path SHALL produce a completed run whose change folder lacks `tasks.md`.

#### Scenario: Depth-S run skips atomicity

- **WHEN** a run classified depth S converges
- **THEN** the pipeline runs decomposition and presents the final gate without an atomicity stage

#### Scenario: Completed run carries the task list

- **WHEN** any run reaches `completed`
- **THEN** the change directory contains a `tasks.md` produced by the pipeline's decomposition stage

### Requirement: Early-gate approval continues the pipeline

When a human approves an early (cap-hit) gate, the pipeline SHALL continue into
the tail — decomposition, atomicity checking, and a final gate — instead of
finalizing the run. An extend SHALL run exactly one more review round and
re-present at the next gate version; a settled gate-level veto SHALL re-enter
draft as a revision round.

#### Scenario: Approval at an early gate proceeds to the tail

- **WHEN** a human approves an early gate (all boxes checked, blockers answered)
- **THEN** the pipeline runs decomposition and atomicity checking and presents the final gate, instead of marking the run completed

#### Scenario: Final gate after early approval carries the next version

- **WHEN** the final gate is presented following an early-gate approval at version `n`
- **THEN** it is written as `gate-<n+1>.md`, preserving the versioned audit trail

#### Scenario: Gate-level veto re-enters draft

- **WHEN** a gate is settled with a gate-level veto redirect
- **THEN** the pipeline re-enters the draft stage as a revision round instead of continuing to the tail

### Requirement: Severity-based convergence

Each review round SHALL count two distinct sets of findings: **raised** —
every finding the reviewers filed, tallied by final class — and **open** — the
subset that still needs a human. A resolution SHALL be open when it was
dismissed; when it claims `assumed` and no assumption record in the round
carries its finding id while at least one record does carry a finding id; or
when it claims `edited` and the round's artifact hash snapshot is unchanged
from the prior round's. A resolution SHALL read closed when it is
`evidence-answered`; when its `assumed` claim is backed by an assumption
record carrying its finding id; when its `edited` claim moved the artifact
hashes; when a round-1 `edited` claim has no prior snapshot to compare; and —
as the pre-change sidecar fallback — when it claims `assumed` in a round whose
assumption records carry no finding ids at all.

The round's verdict SHALL be three-valued: `converged` when nothing above a
nitpick is open and at most three nitpicks are open; `open` when any BLOCKER
or MATERIAL finding is open; and `needs-review` when the open set passes the
converged test but the round recorded an edit above a nitpick that no
reviewer has seen.

Cap-hit routing SHALL read the open set: a round at its cap with zero open
BLOCKER and zero open MATERIAL findings SHALL be treated as converged and
SHALL flow into the tail without presenting an early gate, whatever was
raised; a round at its cap with any open BLOCKER or MATERIAL finding SHALL
present an early gate for human sign-off.

#### Scenario: Fully fixed material finding converges without a gate

- **WHEN** the review loop reaches its round cap with a MATERIAL finding whose resolution claims `edited` and whose round moved the artifact hashes
- **THEN** the pipeline proceeds directly to the tail without a gate

#### Scenario: Open material finding at cap still gates

- **WHEN** the review loop reaches its round cap with at least one open MATERIAL finding — one the resolver dismissed, left unbacked by an assumption record, or claimed as edited without moving the hashes
- **THEN** an early gate is presented and the pipeline waits for a human decision

#### Scenario: Unbacked assumed claim stays open

- **WHEN** a round's resolution claims `assumed`, some assumption record in the round carries a finding id, and none carries this resolution's finding id
- **THEN** the finding counts as open and an above-nitpick one still gates at cap

#### Scenario: Nitpick-only cap-hit converges without a gate

- **WHEN** the review loop reaches its round cap and every open finding is a nitpick, at most three of them
- **THEN** the pipeline proceeds directly to the tail without a gate

### Requirement: Resume covers every stage

A run interrupted anywhere — mid-stage, mid-tail, or at a pending gate — SHALL
be resumable by re-folding the event log and re-entering at the interrupted
stage. Resuming a gate-pending run SHALL direct the operator to the pending
gate file and the resume verb rather than exiting silently.

#### Scenario: Interrupted tail resumes at its stage

- **WHEN** a run stopped during decomposition or atomicity checking is resumed
- **THEN** the pipeline re-enters at the interrupted stage and continues toward the final gate

#### Scenario: Resume on a gate-pending run points at the gate

- **WHEN** `resume` is invoked for a run whose gate is pending
- **THEN** the operator is told the run awaits a gate decision and given the gate file path and run id

### Requirement: Gate decisions disclose their downstream effects

Every gate presentation SHALL state, next to each available decision, what the
pipeline does next if that decision is taken — including that approval at an
early gate continues to the tail, that extend runs one more review round, and
that approval at the final gate completes the run.

#### Scenario: Early gate explains approval

- **WHEN** an early gate is presented
- **THEN** its text states that approving continues the pipeline to decomposition and a final gate, and that extending runs one more review round

### Requirement: Round-open owedness

A `round_open` event SHALL be appended only when it changes the folded round
state. Same-round re-entries — resume of an interrupted round, extend
re-entry, and an under-budget escalation retry — SHALL re-run the round's work
without appending another `round_open`; recursion into round n+1 SHALL always
open. Work-shaped events (findings, convergence, round close) SHALL never be
suppressed by re-entry.

#### Scenario: Interrupted round resumes without re-opening

- **WHEN** a run is interrupted mid-round and resumed into the same round
- **THEN** the round's work re-runs and the event log gains no second `round_open` for that round

#### Scenario: Extend re-entry opens only the next round

- **WHEN** an extend settle moves the loop to the next round
- **THEN** exactly one `round_open` for the new round is appended

### Requirement: Classified resume events

Every `resume` invocation SHALL append exactly one classified `resume` event
recording its re-entry path and stage — including invocations that find a
parked gate or a terminal state. Replay of the event log alone SHALL
reconstruct how each resumption re-entered the run.

#### Scenario: Parked-gate resume records its path

- **WHEN** `resume` is invoked for a run parked at a gate
- **THEN** exactly one `resume` event classified as a gate artifact-skip is appended

#### Scenario: Terminal resume records too

- **WHEN** `resume` is invoked for an already-completed run
- **THEN** exactly one `resume` event is appended and the run state is unchanged

### Requirement: Agent writes are guarded to the run's own change folder

Each agent spawn the pipeline drives SHALL be followed by a working-tree guard
that fails the spawn when the agent dirtied paths outside its run's own change
folder. New dirty entries inside `openspec/changes/<changeName>/` — the change
the run was started with — SHALL pass the guard; new dirty entries in any other
change folder SHALL fail it, with the offending paths and the allowed folder
named in the failure.

#### Scenario: Own-folder writes pass

- **WHEN** an agent dirties only paths under `openspec/changes/<changeName>/` for the change its run was started with
- **THEN** the spawn completes without a guard failure

#### Scenario: Sibling change folder fails the guard

- **WHEN** an agent dirties a path under another change's folder
- **THEN** the spawn fails, naming the offending path and the change folder that was allowed

#### Scenario: Prefix-sharing sibling does not widen the guard

- **WHEN** a run started with change `add-thing` has an agent dirty `openspec/changes/add-thing-extra/spec.md`
- **THEN** the spawn fails — a sibling whose name shares a prefix with the run's change is still outside the allowed folder

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

### Requirement: Verification round at a needs-review cap

A cap-hit whose verdict is `needs-review` SHALL run exactly one further
review round when the budget guard allows it, and SHALL then settle review
whatever that round records: no second verification round SHALL be bought for
the same cap-hit, and an open BLOCKER or MATERIAL finding recorded by the
verification round SHALL still present the early gate — a spent round does not
waive the human's call. The budget guard SHALL follow the R4 metered
semantics: an unknown cumulative cost refuses the round only on a metered
run, and a null cost ceiling never refuses. When the guard refuses, the run
SHALL continue to the tail without spending the round and without appending
an auto-decision for the refusal; the final gate presents the unreviewed
edits to a human either way.

Resume SHALL not skip a pending verification round: a `needs-review` verdict
SHALL leave review unsettled until a later round's verdict is recorded, and a
run interrupted during the verification round SHALL re-enter it.

#### Scenario: Needs-review buys exactly one round

- **WHEN** a round at its cap returns `needs-review` and projected spend is within budget
- **THEN** exactly one further review round runs, and the pipeline then continues to the tail or presents the early gate according to that round's open set

#### Scenario: A second needs-review does not buy another

- **WHEN** the verification round itself returns `needs-review`
- **THEN** no further verification round is bought and review settles into the tail

#### Scenario: Open material from the verification round still gates

- **WHEN** the verification round records an open MATERIAL finding
- **THEN** the early gate is presented for it

#### Scenario: Over-budget refusal flows to the tail

- **WHEN** a `needs-review` cap-hit's projected spend is at or over the configured numeric ceiling, or the run is metered with unknown cost
- **THEN** no verification round is spent, the run continues to the tail, and no auto-decision event is appended for the refusal

#### Scenario: Interrupted verification round re-enters

- **WHEN** a run is interrupted during its verification round and resumed
- **THEN** the verification round re-runs and review does not settle until its verdict is recorded

### Requirement: Per-round artifact hash snapshots

Each review round close SHALL record a hash snapshot of the change folder's
agent artifacts — over the same file set the gate's presentation hashes
cover — keyed by round in the run's sidecars, so an `edited` resolution's
claim is checkable against what actually moved. Snapshots SHALL exclude the
files the runner itself regenerates every round, so a round that changed no
source artifact produces a snapshot equal to the previous round's. A missing
prior snapshot SHALL be tolerated.

#### Scenario: Round close writes its snapshot

- **WHEN** a review round closes
- **THEN** a per-round hash snapshot over the gate's artifact set is recorded in the run's sidecars

#### Scenario: Unchanged artifacts produce an equal snapshot

- **WHEN** a round closes without changing any agent artifact
- **THEN** its snapshot equals the prior round's snapshot

#### Scenario: Regenerated files never mark a round changed

- **WHEN** a round closes having changed only the files the runner regenerates every round
- **THEN** the round's snapshot shows no change and an `edited` claim in that round reads open

### Requirement: Gate rows carry the verbatim gap

Early-gate finding rows SHALL carry the reviewer's verbatim gap, joined from
the round's findings sidecars with both lenses merged, and SHALL degrade to
the finding identifier when a sidecar is missing or malformed. Free text
rendered into a gate file SHALL be sanitized for the file's line-oriented
decision grammar — collapsed to a single line, leading redirect markers
stripped, truncated at a fixed width — and the gate-file writer SHALL flatten
every free-text field it writes, so a gate file parsed back reproduces the
answers it was rendered from whatever prose the reviewers produced.

#### Scenario: Row carries the joined gap

- **WHEN** an early gate renders a finding row for a finding present in the round's findings sidecars
- **THEN** the row carries the finding's verbatim gap rather than its identifier

#### Scenario: Missing sidecar degrades to the identifier

- **WHEN** the round's findings sidecar is missing or malformed
- **THEN** the row degrades to the finding identifier and the gate still renders

#### Scenario: Multi-line gap renders as one sanitized line

- **WHEN** a finding's gap contains newlines or begins with a redirect marker
- **THEN** the rendered row carries it collapsed, stripped, and truncated so it cannot parse as a decision directive

#### Scenario: Written gate files parse back

- **WHEN** a gate file is written from answers whose free-text fields carry multi-line text containing decision directives
- **THEN** parsing the file reproduces the same answers

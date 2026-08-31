# sdd-runner-autonomy delta

## MODIFIED Requirements

### Requirement: R1 converged-final-approve

A final gate whose review round recorded an empty **open** set — no open
BLOCKER, MATERIAL or NITPICK finding — with every surviving assumption
classified low-blast, SHALL be auto-approved by rule R1. Findings the round
raised and resolved SHALL NOT block R1: a finding answered from repository
evidence, an assumed finding with its assumption logged, or an edit that changed
files is not open, and R1 SHALL read the open set rather than the raised set.
The auto-decided gate SHALL still write `gate-<n>.md`, consume a gate version,
have its checkboxes pre-checked, and annotate each decided line with
`decided-by: policy R1`.

#### Scenario: Resolved findings do not block auto-approve

- **WHEN** a final gate's round raised findings and resolved every one of them by
  an edit that changed files or an answer from repository evidence, and all
  surviving assumptions are low-blast
- **THEN** rule R1 approves the gate and the pipeline continues without waiting
  for a human

#### Scenario: A dismissed finding blocks R1

- **WHEN** a final gate's round leaves any dismissed finding of any severity
- **THEN** R1 SHALL NOT fire and the gate SHALL be presented

#### Scenario: A high-blast assumption blocks R1

- **WHEN** the open set is empty but a surviving assumption is classified
  high-blast
- **THEN** R1 SHALL NOT fire and the gate SHALL be presented

### Requirement: R2 trajectory-auto-extend

Rule R2 SHALL read both count sets, each for the question it answers. Its
**eligibility** SHALL be judged over the open set: zero open BLOCKERs and at
least one open MATERIAL. Its **trajectory** SHALL be judged over the raised set:
strictly decreasing raised-finding totals across the last 2 rounds, which
measures whether reviewers are running out of things to say rather than how the
resolver disposed of them. Projected spend SHALL remain under the configured
budget. When all three hold, R2 SHALL auto-extend exactly one round using the
existing extend-round mechanics and `state.roundCap`. Eligibility SHALL be
bounded by the trajectory window and the budget guard alone — there SHALL be no
auto-extend count limit and no auto-extend count state.

#### Scenario: A fixed blocker does not block eligibility

- **WHEN** a cap-hit round raised a BLOCKER and resolved it with an edit that
  changed files, leaves at least one open MATERIAL, shows strictly decreasing
  raised totals across the last 2 rounds, and projects spend under budget
- **THEN** R2 auto-extends exactly one round

#### Scenario: Flat raised trajectory never auto-extends

- **WHEN** a cap-hit run's raised totals are not strictly decreasing across the
  last 2 rounds
- **THEN** no automatic extension occurs and the early gate SHALL be presented

#### Scenario: An empty open set is not an R2 case

- **WHEN** a cap-hit round's open set holds no MATERIAL
- **THEN** R2 SHALL NOT fire, and the round routes by its own verdict rather
  than through an auto-extension

### Requirement: Never-cut invariants

(1) An **open** BLOCKER at a gate SHALL always produce a human gate; no rule
SHALL auto-answer or auto-override one. A BLOCKER the round raised and resolved
is not open and SHALL NOT force a gate on its own. (2) Budget or round-cap
exceedance SHALL always gate. (3) Leaving-the-branch actions SHALL always be
human. (4) Auto-decided gates SHALL still write `gate-<n>.md`, consume a gate
version, and settle through the same integrity-verification path as human
approvals, so they remain hash/audit anchors; the gate-file grammar carries only
an optional `decided-by:` annotation, covered by the write-then-parse
self-check, and the hand-edited path SHALL be unaffected. (5) `events.ndjson`
SHALL remain append-only and replay-sufficient.

#### Scenario: Open BLOCKER always gates

- **WHEN** any gate situation includes a dismissed BLOCKER, or a BLOCKER
  resolved as assumed with no logged assumption, or one resolved as edited whose
  files did not change
- **THEN** the pipeline SHALL present a human gate and no rule SHALL auto-decide
  it

#### Scenario: A resolved blocker does not gate by itself

- **WHEN** a round raised a BLOCKER and resolved it with an edit that changed
  files, and nothing else is open
- **THEN** that BLOCKER alone SHALL NOT force a human gate

### Requirement: auto_decision event

`events.ndjson` SHALL carry an L2 event type `auto_decision` with
`{ rule, decision, evidenceDigest, gateVersion }`. The round-convergence event
SHALL additionally carry the open count set alongside the raised set, so both
numbers a rule consumed are reconstructible from the log alone. The addition
SHALL be additive: a log written before this change SHALL replay unchanged, with
the open set absent reading as equal to the raised set — the pre-change
behavior. The `finding` event's action values SHALL NOT change.

#### Scenario: Replay rebuilds both count sets

- **WHEN** `events.ndjson` from a run is replayed without any other run artifact
- **THEN** every round's raised and open counts are reconstructible, and every
  auto-decision is attributable to the numbers it read

#### Scenario: A pre-change log replays as before

- **WHEN** a log recorded before this change is replayed
- **THEN** it parses without error and each round's open set reads as its raised
  set, reproducing the pre-change verdicts

### Requirement: Decision ladder ordering

Before any human gate is presented the pipeline SHALL evaluate the decision
ladder in order: never-cut pre-checks first, then a deterministic rule, and only
when no rung decides SHALL the human gate be presented. A rule SHALL apply only
while the run remains under the configured budget. Every auto-decision SHALL
cite the rule id and an evidence digest that fired it. Every rule SHALL declare
which count set each of its predicates reads, and the integrity cross-check that
guards the ladder SHALL compare both count sets recomputed from the round's
sidecar against the counts replayed from the event log, failing closed on a
mismatch in either.

#### Scenario: Undecidable situation presents the gate

- **WHEN** a gate situation arises and no rule's predicate matches the recorded
  signals
- **THEN** the human gate SHALL be presented and the situation SHALL be recorded
  as policy debt

#### Scenario: A count-set mismatch fails closed

- **WHEN** either count set recomputed from the round's sidecar disagrees with
  the counts replayed from the event log
- **THEN** the ladder SHALL treat the run as carrying an open blocker, no rule
  SHALL fire, and the gate SHALL be presented

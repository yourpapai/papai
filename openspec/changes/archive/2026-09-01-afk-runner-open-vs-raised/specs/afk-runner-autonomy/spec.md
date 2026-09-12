# afk-runner-autonomy Delta

## MODIFIED Requirements

### Requirement: R1 converged-final-approve

A final gate whose review left zero open findings of any severity — open by
the round's openness predicate, so a finding the resolver fixed with
hash-verified edits no longer blocks approval while a dismissed one still
does — and whose surviving assumptions are all classified low-blast SHALL be
auto-approved by rule R1. The auto-decided gate SHALL still write its gate
file, consume a gate version, and annotate each decided line with the
deciding rule.

#### Scenario: Zero-findings final gate completes without a prompt

- **WHEN** a run converges with zero findings and presents its final gate
- **THEN** rule R1 auto-approves, the gate file exists with pre-checked boxes and rule annotations, and the run reaches `completed` with zero human prompts

#### Scenario: Raised-and-fixed findings no longer block R1

- **WHEN** a final gate's review round raised findings above a nitpick and every one was edited with hash-verified changes, backed by a linked assumption, or evidence-answered
- **THEN** R1 fires

#### Scenario: Any finding blocks R1

- **WHEN** a final gate carries any finding that is open under the openness predicate — a dismissed finding of any severity included — however it was raised
- **THEN** R1 does not fire

### Requirement: R2 trajectory-auto-extend

When a round cap is hit with zero open BLOCKERs and at least one open
MATERIAL finding — both read from the open set, so a blocker the resolver
fixed with hash-verified edits no longer blocks eligibility while a dismissed
one still does — a strictly decreasing raised-finding count across the last
two rounds, and projected remaining spend under the ceiling, rule R2 SHALL
auto-extend exactly one round. Auto-extends per run SHALL be bounded; if the
extended round does not converge or improve, the early gate SHALL be
presented.

#### Scenario: Strictly decreasing burndown auto-extends once

- **WHEN** a cap-hit run has zero open BLOCKERs, open MATERIALs, strictly decreasing raised-finding counts across the last two rounds, and projected spend under the ceiling
- **THEN** the run auto-extends exactly one round, appending an `auto_decision` event, without prompting

#### Scenario: Flat trajectory does not auto-extend

- **WHEN** a cap-hit run's raised-finding count is flat or increasing across the last two rounds
- **THEN** R2 does not fire and the cap-hit gate is presented to the human

#### Scenario: Fixed blocker no longer blocks eligibility

- **WHEN** a cap-hit run's only BLOCKER was edited with hash-verified changes and an open MATERIAL finding remains
- **THEN** R2 evaluates its trajectory and budget predicates without the fixed blocker counting against eligibility

## ADDED Requirements

### Requirement: Counts integrity cross-check

Before the ladder evaluates, the convergence event's recorded counts for the
gate's round — raised and open — SHALL be recomputed from the resolver
sidecar and the round's hash snapshots and compared against the event log. A
mismatch in either set, or an unparseable sidecar, SHALL fail closed: the
ladder SHALL see an open BLOCKER finding naming the integrity failure, so no
rule can auto-decide and the gate waits for a human. A pre-change convergence
event that carries no open set SHALL fold its open set equal to its raised
set for the comparison.

#### Scenario: Open-set drift blocks the ladder

- **WHEN** the sidecar-recomputed open counts disagree with the convergence event's open counts
- **THEN** the ladder sees an open integrity BLOCKER and no rule auto-decides the gate

#### Scenario: Agreement lets the ladder run

- **WHEN** both recomputed count sets agree with the convergence event
- **THEN** the ladder evaluates over the recorded review result unchanged

#### Scenario: Unparseable sidecar fails closed

- **WHEN** the gate's round resolver sidecar fails to parse
- **THEN** the ladder sees an open integrity BLOCKER and the gate waits for a human

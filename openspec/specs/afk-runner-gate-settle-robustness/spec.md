# afk-runner-gate-settle-robustness Specification

## Purpose

Makes the afk-runner gate settle seam total over operator input: every gate shape can express every decision, malformed answers and poisoned files become feedback instead of waiter death, settle claims serialize single attempts rather than gate lifetimes, and the mid-presentation crash window heals on resume.

## Requirements

### Requirement: Expressible decisions at every gate shape

A gate response SHALL be able to express veto and approve at every gate shape, including gates that carry no assumptions, blockers, or findings (item-less gates), through decision-level directives on their own line: `APPROVE` and `VETO` with an optional redirect (`VETO: <text>`). A response section that expresses no decision signal — no directive, no checkbox for a declared item, no blocker answer, no override, no required-ack — SHALL be rejected with guidance naming the accepted directives, and SHALL NOT settle as approve. The `VETO` directive SHALL take precedence over required-ack checks and item boxes, and SHALL be rejected at escalation-mode gates. An `APPROVE` directive together with unchecked declared items SHALL be rejected naming the unchecked items; item boxes SHALL remain authoritative for hand edits at gates that carry items.

#### Scenario: Veto at an item-less final gate

- **WHEN** a converged final gate presents zero assumptions, zero blockers, and zero findings, and the operator writes `VETO: the approach is wrong` in the gate file
- **THEN** the gate settles with outcome veto and the redirect text is preserved for the revision round

#### Scenario: Prose no longer approves silently

- **WHEN** an item-less final gate's response section contains only prose and no directive or decision signal
- **THEN** the settle is rejected with guidance listing the accepted directives and the gate stays pending

#### Scenario: VETO precedes the trajectory ack

- **WHEN** a gate requiring a trajectory ack receives `VETO: <text>` without the ack checked
- **THEN** the gate settles as veto and the missing ack is not raised

#### Scenario: VETO rejected at escalation gates

- **WHEN** an escalation-mode gate's file contains a VETO directive
- **THEN** the settle is rejected stating veto is not valid at an escalation gate

#### Scenario: APPROVE contradicted by unchecked items

- **WHEN** a response contains `APPROVE` and an unchecked box for a declared assumption
- **THEN** the settle is rejected naming the unchecked items

### Requirement: Rendered answers roundtrip their decision

Answers rendered by machine producers (ladder settles, steer translations) SHALL parse back as the decision they encode before any event is appended; a render that fails to roundtrip SHALL overwrite nothing — the gate file's presentation content SHALL survive a failed producer settle attempt. Approve-decision renders SHALL carry the explicit `APPROVE` directive; veto-decision renders without items SHALL carry the `VETO` directive with the redirect when one exists.

#### Scenario: Ladder approve at an item-less gate

- **WHEN** the autonomy ladder auto-approves a gate with no items
- **THEN** the rendered response carries the APPROVE directive with its policy attribution and settles as approve

#### Scenario: Failed producer settle leaves the file intact

- **WHEN** a producer's rendered answers fail to parse back as the same decision
- **THEN** no event is appended and the gate file still contains its presentation content

### Requirement: Gate-level veto reaches the revision round

A settled gate-level veto SHALL run a revision round: the veto updater SHALL receive the whole-gate redirect as a first-class instruction, not as an item with a synthetic identifier. A settled veto with no redirect SHALL run the revision round with an explicit no-redirect instruction. A settled outcome of veto SHALL NOT skip revision silently.

#### Scenario: Whole-gate redirect revises the artifacts

- **WHEN** a gate-level veto with redirect text settles at a final gate
- **THEN** the draft re-entry runs the veto updater with the redirect as its revision instruction and the run re-gates afterwards

#### Scenario: Bare veto revises with no redirect

- **WHEN** a gate-level veto without redirect text settles
- **THEN** the revision round runs with an explicit instruction that the human rejected the change without a redirect

### Requirement: Settle failures become feedback, never waiter death

Operator-input settle failures — unparseable responses, artifact-integrity failures, unreadable integrity sidecars — SHALL be contained: the waiter SHALL stay alive, surface the rejection reason to the operator (a sibling response-error artifact next to the gate file and the waiter's output stream), and SHALL NOT re-attempt the settle until the gate file's content digest changes. Failures of machine producers SHALL remain crash-shaped.

#### Scenario: Malformed hand edit keeps the waiter alive

- **WHEN** the operator's hand-edited response fails to parse
- **THEN** the waiter records the reason in the sibling error artifact, keeps waiting, and does not re-attempt until the file changes again

#### Scenario: Poisoned gate file does not crash-loop

- **WHEN** a resumed waiter finds a gate file whose content already failed a settle attempt and is unchanged
- **THEN** the waiter does not re-attempt the settle and stays alive

#### Scenario: Rejection message hints at missing expected content

- **WHEN** a settle is rejected because an item id the operator addressed is not declared and the gate's expected content is empty
- **THEN** the rejection reason notes that the expected content is empty, suggesting a missing sidecar

### Requirement: Settle claims scope a single attempt

Settle claims SHALL be held for the duration of one settle attempt and released on its outcome — settled or rejected. A waiter SHALL be able to re-claim a claim it itself holds. The deadline expiry path SHALL use the same pid-carried claim as every other producer; a permanent claim artifact SHALL NOT outlive the attempt that created it, and no claim SHALL block a later settle attempt by a live or new process after its attempt ended. Claim content SHALL name its holder's process identity so a dead holder's claim can be reclaimed.

#### Scenario: Rejected settle releases the claim

- **WHEN** a waiter's settle attempt is rejected and the operator later corrects the gate file
- **THEN** the same waiter settles the corrected answer without being blocked by its own earlier claim

#### Scenario: Hand settle during a re-arm window works

- **WHEN** a deadline expiry has fired once, re-armed, and the operator hand-edits an answer before the second deadline
- **THEN** the hand settle proceeds and is not blocked by the earlier expiry attempt's claim

#### Scenario: Second deadline after re-arm still runs the ladder

- **WHEN** a re-armed deadline expires a second time with no conservative ladder branch
- **THEN** the expiry path evaluates the ladder again rather than reporting an already-held claim, and the gate stays pending

### Requirement: Mid-presentation crash heals on resume

When a final gate is presented-unanswered and the presenting stage's bracket is still open (the stage that hosted the presentation remains active in the stage map), a resume SHALL append the owed stage exit for the presenting stage before parking gate-pending, so a later approve can complete the run. The foreground waiter SHALL exit as external when the awaited gate record is already answered.

#### Scenario: Kill after presented recovers completion

- **WHEN** a process dies after the presented event but before the presentation work finished, and the operator resumes and approves the gate
- **THEN** the presenting stage's bracket is closed by resume recovery and the run reaches the completed final

#### Scenario: Answered gate does not re-settle

- **WHEN** the waiter observes a gate record already answered while positioned awaiting
- **THEN** the waiter exits as external instead of appending a duplicate settle sequence

### Requirement: Steer directives are never silently ignored

A steer file SHALL map to a gate-level veto when it names veto without an item assignment (`veto`, or `veto <text>`), and to an item veto when it carries `veto <id>=<redirect>`. A steer file whose first line matches no directive grammar SHALL be consumed with a warning rather than left in place unexamined. Extend at a final gate and veto at an escalation gate SHALL keep being skipped with a warning.

#### Scenario: Bare steer veto settles gate-level

- **WHEN** a parked item-less final gate receives a steer file reading `veto`
- **THEN** the gate settles as a gate-level veto without crashing the waiter

#### Scenario: Unparseable steer is warned and consumed

- **WHEN** a steer file's first line matches no directive grammar
- **THEN** the waiter warns, consumes the file, and continues waiting

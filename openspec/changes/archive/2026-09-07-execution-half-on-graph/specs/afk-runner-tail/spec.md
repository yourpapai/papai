## MODIFIED Requirements

### Requirement: Outcome-ordered settlement at final gates

The settle seam SHALL order its appends by outcome at a final gate: on an unarmed run, approve appends the gate stage exit before the answered event (so the completed edge fires on the answer); on an execution-armed run, approve appends the gate stage exit, then the implement mover (`stage_enter(implement)`, which activates implement so the completed edge cannot fire), then the answered event. Extend and veto append the answered event first (keeping the gate stage active so the completed edge cannot fire), then the gate stage exit, then the mover event; abort appends the answered event alone. At an early gate the seam SHALL append no gate stage exit.

#### Scenario: Approve completes on the answered event

- **WHEN** an unarmed run's final gate settles approve
- **THEN** the log shows `stage_exit(gate)` then the answered event, and the machine reaches the completed final

#### Scenario: Armed approve enters execution on the answer

- **WHEN** an execution-armed run's final gate settles approve
- **THEN** the log shows `stage_exit(gate)`, the implement mover, then the answered event; implement is active when the answer lands so completion stays blocked, and the machine sits in implement

#### Scenario: Extend does not complete the run

- **WHEN** a final gate settles extend
- **THEN** the answered event arrives while the gate stage is still active, the completed edge does not fire, and the mover `round_open` moves the machine back to review

#### Scenario: Veto re-enters draft

- **WHEN** a final gate settles veto
- **THEN** the machine moves to draft for the revision round without passing through completed

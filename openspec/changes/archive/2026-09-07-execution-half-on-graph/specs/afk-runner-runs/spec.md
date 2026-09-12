## MODIFIED Requirements

### Requirement: Actionable status rendering

Each row's status SHALL render the run's terminal or live status (`completed`, `aborted`, `failed`, `stopped`, `running`), except a run parked at an unanswered gate, which SHALL render as `gate:<mode> v<version>` naming the gate mode and version, and a run driving the execution states, which SHALL render as `exec:<stage>` with task progress (`exec:implement 3/7`) naming the execution stage and done-versus-total tasks when task records exist.

#### Scenario: Gate-pending row

- **WHEN** a run is parked awaiting settlement of an escalation gate at version 2
- **THEN** its row renders the status as `gate:escalation v2`

#### Scenario: Terminal row

- **WHEN** a run has completed
- **THEN** its row renders the status as `completed`

#### Scenario: Executing row shows progress

- **WHEN** a live run is driving implement with three of seven tasks recorded done
- **THEN** its row renders the status as `exec:implement 3/7`

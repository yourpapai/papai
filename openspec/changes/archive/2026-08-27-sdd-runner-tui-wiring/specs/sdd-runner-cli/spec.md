# sdd-runner-cli delta

## ADDED Requirements

### Requirement: Runner-printed guidance names the current routing surface

Whenever the runner halts a run — at a pending gate decision, or interrupted and resumable — the next-step hint it prints SHALL be the routing invocation that reopens that flow (`sdd <run-id>`). Runner output SHALL NOT direct the operator to a removed subcommand form.

#### Scenario: Gate-halted run points at the routing verb

- **WHEN** a fresh run halts after presenting its gate
- **THEN** the printed hint names `sdd <run-id>` and no removed subcommand form appears in the runner's output

#### Scenario: Interrupted run points at the routing verb

- **WHEN** a calmly stopped run is reported as resumable
- **THEN** the printed hint names `sdd <run-id>`

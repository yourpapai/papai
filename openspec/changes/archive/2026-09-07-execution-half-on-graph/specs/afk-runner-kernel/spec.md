## MODIFIED Requirements

### Requirement: Golden replay parity

Historical `sdd-runner` run logs SHALL replay through the kernel to a derived stage map equivalent to the legacy replay fold (`ReplayState.stages`) over the legacy stage vocabulary: the execution stages' entries in the kernel map are kernel-only residue, pending in every historical log, and SHALL NOT be compared against the legacy map. Unknown-to-the-graph events in a log SHALL be tolerated by the fold without failing the replay.

#### Scenario: Historical log parity

- **WHEN** an existing `sdd-runner` run's `events.ndjson` is folded through the kernel
- **THEN** the resulting stage statuses for the legacy stages match the legacy `replayEvents` output for the same log, with the execution stages pending

#### Scenario: Tolerant replay

- **WHEN** a log contains event types the graph does not transition on
- **THEN** the fold skips them without error and retains the state derived from recognized events

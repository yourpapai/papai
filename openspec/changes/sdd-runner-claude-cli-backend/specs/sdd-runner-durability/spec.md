## MODIFIED Requirements

### Requirement: Session ledger records every spawn

The runner SHALL append one ledger line per agent spawn attempt to the run's session ledger (`sessions.jsonl`), capturing the agent session id as soon as it appears in that agent's event stream — the opencode session id on the opencode route, the CLI-reported session id on the claude route — plus the spawn's role, round, attempt, model, and final status. A crash mid-agent SHALL still leave the session id on disk. The ledger line's fields and their meanings SHALL NOT vary by route.

#### Scenario: Id recorded before the agent completes

- **WHEN** an agent spawn emits its first session-bearing event line
- **THEN** a ledger line exists on disk containing that session id before the spawn's outcome is known

#### Scenario: Killed spawn is marked

- **WHEN** a spawn is killed before producing its artifact
- **THEN** its ledger line records the killed status, leaving the session id available for resume

#### Scenario: The ledger line shape does not vary by route

- **WHEN** the same stage spawns once on each backend route
- **THEN** both ledger lines carry the same fields with the same meanings, each holding the session id its own route reported

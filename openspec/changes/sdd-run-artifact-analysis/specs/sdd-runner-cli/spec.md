## ADDED Requirements

### Requirement: Analysis verb routing

The runner's single start script SHALL accept an `analyze [workdirs…]` invocation that routes to the read-only run-artifact analysis surface, distinct from task-file starts and run-id routing. Run-id prefixes, gate-pending discovery, and every existing routing behavior SHALL be unchanged; an argument list whose first token is `analyze` SHALL never be interpreted as a run id or task file.

#### Scenario: Analyze routes without touching runs

- **WHEN** the start script is invoked with `analyze ../other-worktree/.sdd-runner`
- **THEN** the analysis surface SHALL run over that workdir's runs and the invocation SHALL NOT route into any run, gate, or resume flow

#### Scenario: Existing routing is unchanged

- **WHEN** the start script is invoked with a run-id prefix or a task-file path as the first argument
- **THEN** routing SHALL behave exactly as before this capability was added

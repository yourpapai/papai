## ADDED Requirements

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

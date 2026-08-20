# mutation-improve-artifact-scope Specification

## Purpose

Defines what the mutation-coverage runner requires an improvement agent to produce for each
file it improves, and where the reasoning about accepted residual mutants is recorded.

## Requirements

### Requirement: The runner requires no planning documents per improved file

The mutation-coverage runner SHALL NOT require an improvement agent to author a design
document or a task list for a file it improves. Its required output SHALL be the measured
report it works from, the tests it adds, and its structured result.

#### Scenario: Agent improves a file

- **WHEN** the runner dispatches an improvement agent for a file
- **THEN** the procedure it receives requires no design document and no task list
- **AND** an agent that produces neither is not failed for their absence

#### Scenario: Agent writes such a document anyway

- **WHEN** an agent writes a planning document despite not being asked
- **THEN** the iteration is judged on its gates alone
- **AND** the document's presence neither satisfies nor violates any check

### Requirement: Residual reasoning is recorded in the structured result

The runner SHALL require reasoning about accepted residual mutants in its structured result
rather than in prose beside it. Each residual SHALL name the mutant ids it covers, and the
runner SHALL continue to require that the union of declared ids exactly equals the ids it
measured as surviving.

#### Scenario: A file lands below target with declared residuals

- **WHEN** an agent declares residuals covering every surviving mutant id and no others
- **THEN** the declaration is accepted exactly as it is today
- **AND** the reasoning for each residual is present in the result

#### Scenario: Declared residual ids do not match the measurement

- **WHEN** the declared ids omit a survivor or name one that did not survive
- **THEN** the iteration fails, unchanged from current behaviour

### Requirement: A result without document paths is valid

The runner SHALL accept a result that carries no design or task document path. A result
carrying such paths, written before this requirement existed, SHALL remain valid.

#### Scenario: Agent returns a result naming no documents

- **WHEN** an improvement agent returns its result with no document paths
- **THEN** the result validates and the iteration proceeds to its gates

#### Scenario: A run started earlier is resumed

- **WHEN** a run is resumed whose stored results carry document paths
- **THEN** those results load without error

### Requirement: The run's report states what residuals were accepted

The runner SHALL report, for each improved file, what residual mutants were accepted and
why, in the report it publishes at the end of a run. The report SHALL NOT depend on a
document authored by the agent.

#### Scenario: A run finishes with accepted residuals

- **WHEN** a run completes having accepted residuals on one or more files
- **THEN** the published report states the residuals and their reasoning per file

#### Scenario: A run finishes with no residuals accepted

- **WHEN** every improved file reached the target with no residuals declared
- **THEN** the report says so and names no documents

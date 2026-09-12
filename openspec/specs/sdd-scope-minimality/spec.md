# sdd-scope-minimality Specification

## Purpose

Defines the necessity question a drafted proposal must answer before scope is admitted into
a change, where declined scope is recorded, and the boundary between admitting scope and
dividing it.

## Requirements

### Requirement: A proposed capability states what breaks without it

The planning rules SHALL require every capability a proposal declares to state the concrete
consequence of not building it. A capability whose only stated justification is a future or
speculative need SHALL NOT be admitted as scope.

#### Scenario: Drafter proposes a capability for an anticipated need

- **WHEN** a drafter proposes a capability justified by a need that has not arisen
- **THEN** the rules it received require a stated consequence of omitting it
- **AND** a capability with no such consequence belongs in Non-goals rather than in scope

#### Scenario: Drafter proposes a capability with a present consequence

- **WHEN** omitting a capability would leave a described behaviour broken or absent
- **THEN** the capability is admitted and the consequence is stated in the proposal

### Requirement: A proposal names existing coverage before adding scope

The planning rules SHALL require a drafter to name the existing capability, module, or
dependency that already covers a proposed capability, where one exists, rather than
introducing a parallel one.

#### Scenario: Proposed capability duplicates an existing one

- **WHEN** a proposed capability is already covered by something in the codebase
- **THEN** the proposal names it
- **AND** the proposal either extends that capability or records why a separate one is needed

#### Scenario: Nothing existing covers the capability

- **WHEN** a drafter finds no existing coverage
- **THEN** stating that is a complete answer and the capability proceeds

### Requirement: Declined scope is recorded, not dropped

Scope considered and rejected on necessity grounds SHALL be recorded in the proposal's
Non-goals section rather than omitted silently, so that a later reader can tell declined
scope from scope nobody considered.

#### Scenario: A drafter rejects scope during drafting

- **WHEN** a drafter considers a capability and rejects it as unnecessary
- **THEN** it appears in Non-goals with the reason

#### Scenario: A reader revisits the change later

- **WHEN** a reader asks why an obvious adjacent capability is absent
- **THEN** the Non-goals section distinguishes a deliberate decline from an oversight

### Requirement: Scope minimality does not govern task division

The planning rules SHALL apply the necessity question to what a change admits, and SHALL
NOT apply it to how admitted work is divided into tasks. The task rules and the pipeline's
atomicity check SHALL remain unchanged, and the boundary SHALL be documented.

#### Scenario: A task list is decomposed

- **WHEN** admitted work is broken into tasks, or the atomicity check splits a task that
  bundles several
- **THEN** no minimality rule opposes the split
- **AND** the task rules the drafter receives are unchanged by this capability

#### Scenario: A reader compares the two rule sets

- **WHEN** a reader reads the scope rules and the task rules together
- **THEN** the documented boundary states that one governs admission and the other division

### Requirement: Planning rules reach every artifact drafter unchanged

The planning rules SHALL be delivered to every agent that drafts a change artifact, carried
verbatim from the project configuration rather than restated per drafter.

#### Scenario: An artifact is drafted by any pipeline

- **WHEN** an agent is asked to draft a proposal or design artifact
- **THEN** the rules it receives are the project's configured rules for that artifact
- **AND** no drafter substitutes its own wording for them

#### Scenario: A rule is added to the project configuration

- **WHEN** a rule is added for an artifact
- **THEN** every drafter of that artifact receives it without a change to that drafter

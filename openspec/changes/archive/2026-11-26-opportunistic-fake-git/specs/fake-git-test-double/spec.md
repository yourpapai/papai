# fake-git-test-double Specification

## Purpose

Defines the shared test double for the `Git` interface: one audited, type-checked fake instead of per-file hand-written ones, with a conversion rule that keeps real git exactly where git is the behavior under test.

## ADDED Requirements

### Requirement: The fake implements the full Git interface

The shared double SHALL implement every member of the `Git` interface, checked at compile time (assignability to the interface type), so interface evolution that the fake misses is a type error, not a silent undefined call at runtime.

#### Scenario: Interface drift breaks the build, not the test run

- **WHEN** a member is added to the `Git` interface
- **THEN** the shared fake fails to compile until it implements the member

### Requirement: Outcomes are scriptable and recorded

Every fake method SHALL accept a scripted outcome (resolved value or rejection) per invocation and SHALL record each call (method and arguments) in an inspectable log. Scripting SHALL cover the outcome shapes production callers distinguish (clean vs. conflicted vs. failed).

#### Scenario: A scripted failure reaches the caller as a rejection

- **WHEN** a test scripts the next `push` call to reject with an error
- **THEN** the code under test observes that rejection, and the call log shows the recorded `push` invocation with its arguments

### Requirement: Real git stays where git is the subject

Tests asserting git's own semantics (merge/rebase outcomes, conflict file lists, worktree state) SHALL NOT use the fake. The fake is for code whose behavior is *around* git (orchestration, retry, sequencing), where git is ambience.

#### Scenario: git-semantics tests keep real repositories

- **WHEN** the test suite runs
- **THEN** the files asserting git semantics still construct real repositories, and the change's task list names them as unconverted by design

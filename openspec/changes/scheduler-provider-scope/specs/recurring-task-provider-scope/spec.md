## Purpose

Ensures recurring-task scheduler executions perform task-provider I/O inside a valid, per-task provider request scope so instances are created successfully and the requests are attributable to scheduler activity, degrading to explicit unobserved execution rather than failing.

## ADDED Requirements

### Requirement: Scheduler provider I/O executes under an attributed scope

When a due recurring task is executed by the scheduler and its assigned task provider performs any request, the system SHALL run that request inside a provider request scope attributed with scheduler invocation mode, a system actor role, and the recurring task owner as the chat user, across all platform instances and all task provider types (built-in and contributed).

#### Scenario: Recurring task instance is created

- **WHEN** a due recurring task executes against a configured task instance and the provider performs I/O (task creation, status/column lookup, label assignment)
- **THEN** the I/O settles inside a valid provider request scope and the recurring task instance is created (no scope-missing failure)

#### Scenario: Attribution fields

- **WHEN** a scheduler-executed provider request is observed
- **THEN** it carries scheduler invocation mode, system actor role, the task owner as chat user, and the owner's platform instance and context identifiers

#### Scenario: Provider-agnostic application

- **WHEN** the owner's context is assigned to any task provider type (e.g. Kaneo, YouTrack, or a contributed provider)
- **THEN** the scheduler scope applies uniformly and the instance creation behaves identically

### Requirement: One scope per due task

The scheduler SHALL establish an independent scope per due recurring task execution, scoped to that task's owner, so concurrent or successive tasks in one tick never share or inherit each other's attribution.

#### Scenario: Multiple due tasks in one tick

- **WHEN** several recurring tasks owned by different users are due in the same scheduler tick
- **THEN** each task's provider I/O is attributed to its own owner under its own scope

#### Scenario: Work detached past the execution

- **WHEN** provider I/O is initiated after a task's execution has fully settled
- **THEN** that I/O fails closed per the provider scope lease semantics rather than silently attributing to the finished task

### Requirement: Scope resolution never blocks execution

The scheduler SHALL NOT fail, skip, or delay recurring task execution because of scope resolution: when analytics is inactive or the owner's platform route or identity cannot be resolved, execution SHALL proceed under the explicit no-analytics sentinel (unobserved), and the recurring task instance SHALL still be created.

#### Scenario: Analytics inactive

- **WHEN** a due recurring task executes while no analytics runtime is active
- **THEN** provider I/O proceeds under the explicit no-analytics sentinel and the instance is created without observation

#### Scenario: Owner route unresolvable

- **WHEN** the task owner's storage-context id cannot be resolved to a platform instance and native context
- **THEN** execution proceeds under the no-analytics sentinel rather than failing

#### Scenario: No task instance assigned

- **WHEN** the owner's context has no task instance configured (null)
- **THEN** the scheduler skips execution before any provider I/O, exactly as before this capability

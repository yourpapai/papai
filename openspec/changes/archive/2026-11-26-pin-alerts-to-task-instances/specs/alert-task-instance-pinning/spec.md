# alert-task-instance-pinning Specification

## Purpose

Binds every alert to the task instance it was created against, so that
switching or deleting a group's task instance never silently re-points
existing alerts at a different tracker's task ids. NULL-pinned (legacy or
unconfigured) alerts keep the previous delivery-context resolution.

## ADDED Requirements

### Requirement: Alerts record their creating task instance

The system SHALL capture the task instance configured for the alert's
delivery config context at alert creation time and store it on the alert
as its pin. Alerts created in a config context with no task instance
configured SHALL store a NULL pin. Alerts that predate pinning SHALL keep
a NULL pin, with no backfill.

#### Scenario: Alert created with a configured task instance

- **WHEN** a user creates an alert while the alert's delivery config
  context has task instance A configured
- **THEN** the stored alert is pinned to A

#### Scenario: Alert created with no task instance configured

- **WHEN** a user creates an alert in a config context whose task
  instance is not configured (null)
- **THEN** the stored alert has a NULL pin

#### Scenario: Legacy alerts keep a NULL pin

- **WHEN** an alert created before pinning existed is loaded after the
  capability ships
- **THEN** its pin is NULL and its behavior is unchanged from before
  pinning existed

### Requirement: Pinned alerts evaluate against the pinned instance

The system SHALL resolve the task provider for an alert with a non-NULL
pin from the pinned task instance, regardless of which task instance the
delivery config context currently has configured. Context-scoped fields
of the provider configuration other than the instance (for example a
per-context token) SHALL still come from the alert's delivery context.
The system SHALL NOT evaluate a pinned alert against a task instance
other than its pin. An alert with a NULL pin SHALL resolve its task
provider from the delivery config context's currently configured task
instance, exactly as before pinning existed.

#### Scenario: Context switches tracker after alert creation

- **WHEN** an alert pinned to instance A is due for evaluation and its
  delivery config context is now configured with instance B
- **THEN** the alert is evaluated through instance A's task provider and
  never through B's

#### Scenario: Per-context credentials still come from the delivery context

- **WHEN** a pinned alert is evaluated and its provider configuration
  includes a context-scoped credential
- **THEN** that credential is taken from the alert's delivery context,
  not from whichever context owns the pinned instance

#### Scenario: NULL-pinned alert follows its context

- **WHEN** a NULL-pinned alert is due for evaluation
- **THEN** it is evaluated through the task provider resolved from its
  delivery config context's current task instance, matching pre-pinning
  behavior

### Requirement: Unresolvable pin auto-cancels the alert

The system SHALL set the status of any active alert to `cancelled` when
its non-NULL pin refers to a task instance that no longer resolves
(deleted or otherwise unresolvable), SHALL log the cancellation at info
level, and SHALL NOT evaluate such an alert against any other task
instance. This SHALL hold both when detected during alert polling and
when detected via an explicit task-instance switch or delete path.

#### Scenario: Polling detects a deleted pinned instance

- **WHEN** an active alert pinned to instance A comes due for evaluation
  and instance A no longer resolves
- **THEN** the alert's status becomes `cancelled`, the cancellation is
  logged at info level, and no evaluation is performed for it

#### Scenario: Cancelled alert is never re-pointed

- **WHEN** an alert pinned to a no-longer-resolvable instance A is
  handled and its delivery context has instance B configured
- **THEN** the alert is cancelled rather than evaluated against B

### Requirement: Switching a context's task instance cancels old-pinned alerts

The system SHALL, when a config context's task instance assignment
changes away from an old instance, cancel every active alert pinned to
that old instance whose delivery target resolves into that config
context, logging each cancellation at info level. Active alerts with a
NULL pin or a pin on an unaffected instance that deliver into the same
config context SHALL remain active.

#### Scenario: Switch cancels alerts pinned to the old instance

- **WHEN** a config context's task instance changes from A to B and
  active alerts pinned to A deliver into that config context
- **THEN** those alerts are cancelled with an info log and are not
  silently re-pointed to B

#### Scenario: NULL-pinned alerts survive a switch

- **WHEN** a config context's task instance changes and NULL-pinned
  alerts deliver into that config context
- **THEN** those alerts remain active and at their next evaluation
  resolve via the context's newly configured task instance

#### Scenario: Alerts pinned to other instances survive a switch

- **WHEN** a config context's task instance changes from A to B and an
  active alert pinned to instance C (distinct from A) delivers into that
  config context
- **THEN** that alert remains active and continues to be evaluated
  against C

### Requirement: Deleting a task instance cancels its pinned alerts first

The system SHALL cancel every active alert pinned to a task instance,
regardless of delivery config context, before that task instance is
deleted, logging each cancellation at info level. Data-level referential
integrity on deletion SHALL remain only as a backstop, not as the primary
cancellation mechanism.

#### Scenario: Delete cancels all pinned alerts across contexts

- **WHEN** a task instance A holding active pinned alerts is deleted
- **THEN** each of those alerts is cancelled with an info log before the
  task instance is removed, including alerts delivering into config
  contexts other than the one that owned A

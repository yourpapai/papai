## Purpose

Turns permanently-failing recurring templates (provider-classified `project-not-found`) from silent every-minute retry storms into schedule-bounded attempts with an owner notice, while leaving transient-failure behavior untouched.

## ADDED Requirements

### Requirement: Recurring permanent failure consumes the scheduled attempt

When a due recurring task's creation fails with a provider-classified `project-not-found`, the scheduler SHALL record a failed execution: set `lastRun` to the attempt time, advance `nextRun` to the next occurrence per the template's schedule, and SHALL NOT record an occurrence row. Transient failures (network, 5xx, auth, or any non-project-not-found class) SHALL keep the existing behavior of retrying on the next tick without touching run state.

#### Scenario: No retry storm

- **WHEN** a daily recurring template's creation fails with `project-not-found`
- **THEN** its next attempt is the next scheduled occurrence (not the next 60-second tick) and no occurrence row is created

#### Scenario: Transient failures retry as before

- **WHEN** creation fails with a network or server error
- **THEN** run state is untouched and the template is retried on the next tick, exactly as before this capability

#### Scenario: Catch-up does not resurrect failed attempts

- **WHEN** a catch-up-enabled template consumed a failed scheduled attempt
- **THEN** that attempt is not recreated as a missed date on a later resume

### Requirement: Owner notified of permanent recurring failure

When a due recurring task's creation fails with a provider-classified `project-not-found`, the scheduler SHALL deliver a direct failure notice to the owner through the same notification route as the success notice, stating the task, the reason (project no longer available), and the remedy (update or disable the template). The notice SHALL be sent once per failed scheduled attempt; a notification delivery failure SHALL be logged and SHALL NOT prevent the schedule from advancing. When the notification route is unavailable, the scheduler SHALL log a warning and still advance the schedule.

#### Scenario: Owner DM on permanent failure

- **WHEN** creation fails with `project-not-found` and the owner's DM route is active
- **THEN** the owner receives one failure notice for that scheduled attempt and the template's schedule advances

#### Scenario: Notification failure is isolated

- **WHEN** the failure notice cannot be delivered (platform send fails)
- **THEN** the schedule still advances and the failure is logged

#### Scenario: Provider-agnostic trigger

- **WHEN** any configured task provider's `classifyError` returns `project-not-found` for the creation failure
- **THEN** the same permanent-failure handling applies regardless of provider type

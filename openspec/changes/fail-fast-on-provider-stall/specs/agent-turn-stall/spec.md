# agent-turn-stall — fail-fast-on-provider-stall

## Purpose

Detects, while a model turn is still outstanding, that the provider has stopped
serving it (retries or session errors with no model progress), aborts the turn
cheaply instead of burning the whole-turn deadline, and records the provider's
own failure text in the encrypted debug transcript so the next outage is
diagnosable.

## ADDED Requirements

### Requirement: Stall bound aborts a live turn

While a model turn is outstanding, the pipeline SHALL abort the turn and raise
a failure classified as a provider stall when, for a continuous window of at
least `AGENT_STALL_TIMEOUT_MS`, the turn has produced no progress — no finished
model step and no newly started tool call — AND at least one provider retry or
session error has been observed inside that window. A turn making progress, or
one that is merely slow with no provider retry evidence, SHALL NOT be aborted
by this bound.

#### Scenario: Dead retry spiral ends early

- **WHEN** the provider streams no tokens and the session retries the same
  request continuously for `AGENT_STALL_TIMEOUT_MS` with no finished step and
  no tool call started
- **THEN** the turn is aborted within the job, well before the whole-turn
  deadline, and the run reports a provider-stall failure naming the stall
  window, the observed retry count and the progress the turn had made

#### Scenario: Slow but healthy turn is not aborted

- **WHEN** a model call produces no events for longer than
  `AGENT_STALL_TIMEOUT_MS` but no provider retry or session error occurs
- **THEN** the turn continues and the bound does not fire

#### Scenario: Recovering blip does not fire the bound

- **WHEN** the provider fails a few times and then serves the turn, finishing a
  model step within `AGENT_STALL_TIMEOUT_MS` of the last progress
- **THEN** the bound does not fire and the stall evidence resets at the next
  finished step

### Requirement: Stall stop is recoverable

A provider-stall abort SHALL be distinguishable by machine-readable code from
both the whole-turn deadline and ordinary work failures. On the implement path
it SHALL salvage whatever the tree holds (same treatment as the whole-turn
deadline) except that it SHALL NOT ask the model for a wrap-up handoff. In all
phases the run SHALL park in FAILED with its resume point intact, so the
existing `/retry` recovery applies and no attempt-consuming re-run of finished
work is implied.

#### Scenario: Implement step stalls mid-flight

- **WHEN** a provider stall aborts an implement step that had already written
  to the working tree
- **THEN** the salvage path commits and pushes that partial work and the run
  parks in a state `/retry` resumes, without prompting the unreachable model
  for a handoff

#### Scenario: Planning turn stalls

- **WHEN** a provider stall aborts a planning turn
- **THEN** the run parks in FAILED with `resumeFrom` naming the planning phase
  and the failure notice names the stall, not the whole-turn deadline

### Requirement: Provider failure text reaches the encrypted transcript only

The provider's own message carried by provider-retry and session-error events
SHALL be recorded in the encrypted debug transcript — redacted by value before
encryption — for every occurrence, alongside a synthetic provider row when no
tool row is running. The public Actions log SHALL continue to carry only
names, statuses, attempt counts and totals for these events, and no provider
message.

#### Scenario: Retry spiral is diagnosable after the fact

- **WHEN** a run aborts on the stall bound and the maintainer decrypts the
  transcript with `AGENT_LOG_KEY`
- **THEN** each provider retry appears as a transcript row carrying the
  provider's own message text, and no credential value appears in the decrypted
  output

#### Scenario: Public log stays structural

- **WHEN** provider retries stream during a turn
- **THEN** the public Actions log shows only the status, the attempt number and
  the running totals, never the provider message

### Requirement: Stall bound is configurable

The stall window SHALL be read from `AGENT_STALL_TIMEOUT_MS` as a
range-checked positive integer in milliseconds, defaulting to 300000 (5
minutes); `0` SHALL disable the bound explicitly. An invalid value SHALL fail
config load with a message naming the variable, and the disabled state SHALL
behave exactly as the pipeline did before this change.

#### Scenario: Operator disables the bound

- **WHEN** `AGENT_STALL_TIMEOUT_MS=0` is set for a run
- **THEN** no turn is aborted by the stall bound and the whole-turn deadline
  remains the only turn bound

#### Scenario: Garbage value refused

- **WHEN** `AGENT_STALL_TIMEOUT_MS=banana` is set
- **THEN** config load fails naming the variable rather than silently falling
  back

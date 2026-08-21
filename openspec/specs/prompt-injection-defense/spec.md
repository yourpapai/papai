# prompt-injection-defense Specification

## Purpose

Defines how papai separates untrusted external data (task-tracker titles,
urls, and extracted memory facts) from instructions before that data enters
LLM prompts, so tracker content cannot steer the agent across the trust
boundary.

## Requirements

### Requirement: Boundary marking of external task data

The system SHALL sanitize and wrap task titles and urls from task providers
in XML delimiters carrying a per-process random token before interpolating
them into deferred-prompt alert summaries, and SHALL include a framing line
stating that tagged content is data, not instructions.

#### Scenario: Alert fires with instruction-like task title

- **WHEN** an alert evaluation matches a task whose title contains text
  resembling prompt instructions or external-data boundary forgery
- **THEN** the dispatched alert summary contains the title inside
  external-data delimiters with the process token, any literal
  boundary-forging sequences stripped, and the framing line present

#### Scenario: Ordinary task titles pass through intact

- **WHEN** an alert evaluation matches tasks with plain titles and urls
- **THEN** each title/url appears wrapped and untruncated (under 500 chars)
  with semantics unchanged

### Requirement: Boundary marking of memory facts

The system SHALL sanitize and wrap fact identifier, title, and url fields
in the same external-data delimiters when rendering the memory context
block.

#### Scenario: Fact text resembles instructions

- **WHEN** a stored memory fact's title contains instruction-like text
- **THEN** the rendered memory context shows the fact inside external-data
  delimiters rather than as bare prompt text

### Requirement: Token unguessability and non-exposure

The boundary token SHALL be generated per process from a cryptographic
random source and SHALL NOT be logged, included in prompts other than as
the delimiter attribute, or exposed via any user-facing surface.

#### Scenario: Token generation

- **WHEN** the process starts and the first external string is wrapped
- **THEN** the token is a fixed random value for the process lifetime and
  no log line contains it

### Requirement: Always-on, no content alteration of user messages

The defense SHALL apply unconditionally (no config flag) and SHALL NOT
modify the content of authorized users' chat messages.

#### Scenario: No configuration surface

- **WHEN** runtime config is inspected for a toggle disabling the boundary
- **THEN** no such key exists and wrapping applies to every alert summary
  and memory context render

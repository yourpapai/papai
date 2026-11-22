# tool-permissions Specification

## Purpose

Defines what a resolved per-context tool permission means at runtime: which tools are exposed, when a call must be approved before it runs, and what the model and the operator observe when approval is granted, denied, times out, or has no surface.

## Requirements

### Requirement: Resolved permissions decide tool exposure

The system SHALL expose an `allow` tool unchanged, expose an `ask` tool behind the approval flow, and omit a `deny` tool from the toolset entirely. Resolution SHALL remain most-specific-wins over per-tool overrides, legacy aliases, domain defaults, risk defaults, and an implicit `allow`.

#### Scenario: Denied tool is absent

- **WHEN** a tool resolves to `deny` for the turn's storage context
- **THEN** the tool is not offered to the model and cannot be invoked

#### Scenario: Most specific permission wins

- **WHEN** a tool has a per-tool override of `allow` while its risk default is `ask`
- **THEN** the tool is exposed without an approval prompt

### Requirement: Ask-gated calls are approved before they execute

The system SHALL obtain an explicit approval before an `ask`-gated tool body runs, and SHALL run the body at most once per approved call. The approval SHALL happen within the same model turn, so the turn's steering target, stop control, step budget, and usage accounting are unchanged.

#### Scenario: Approved call executes once

- **WHEN** the user approves an `ask`-gated call
- **THEN** the tool body runs once and its result returns to the model in the same turn

#### Scenario: No execution without a decision

- **WHEN** a call is awaiting approval
- **THEN** the tool body has not run and the turn is still live

### Requirement: A denial is visible to the model and never executes

The system SHALL report a denied call to the model as a denial carrying the user-facing reason, rather than as a tool failure or a fabricated result payload. The turn SHALL continue so the model can re-plan without the denied action.

#### Scenario: Model receives the denial

- **WHEN** the user denies an `ask`-gated call
- **THEN** the model receives a denial result with the reason and the tool body never runs

#### Scenario: Turn continues after denial

- **WHEN** a denial has been reported
- **THEN** the model continues the same turn and may choose another action

### Requirement: Approval prompt lifecycle is bounded

The approval prompt SHALL show the tool name, the model-authored reason, and the call arguments with sensitive values masked. An unanswered prompt SHALL count as a denial after five minutes. A turn with no approval surface SHALL deny the call without prompting.

#### Scenario: Timeout denies

- **WHEN** no decision arrives within five minutes
- **THEN** the call is denied and the model receives the denial with a timeout reason

#### Scenario: No approval surface

- **WHEN** an `ask`-gated call occurs on a turn that has no chat surface for prompting
- **THEN** the call is denied without a prompt and the model receives the denial

### Requirement: Denial outcomes stay observable

The system SHALL record a denied approval as the `permission_denied` tool-execution outcome and keep the confirmation lifecycle facts (`granted`, `denied`, `ignored`, `prompt_failed`). A denied call SHALL count as a tool-failure signal for the turn's verified-completion verdict.

#### Scenario: Analytics outcome

- **WHEN** an `ask`-gated call is denied
- **THEN** tool-terminal analytics record `permission_denied` for that call

#### Scenario: Risky-turn verdict

- **WHEN** a turn ends after a denied call
- **THEN** the turn is classified as having a tool failure, not as clean

### Requirement: Approval state is thread-isolated and does not mutate configuration

The system SHALL key permission resolution and any pending approval by the turn's storage context id, and SHALL NOT write `tool_prefs`, guest-mode settings, group-shared configuration, or task-instance state when a decision is made.

#### Scenario: Thread isolation

- **WHEN** two threads have pending approvals at the same time
- **THEN** each decision applies only to its own thread's call

#### Scenario: No durable change

- **WHEN** an approval or denial is recorded
- **THEN** no per-context permission, guest-mode, or task-instance configuration changes

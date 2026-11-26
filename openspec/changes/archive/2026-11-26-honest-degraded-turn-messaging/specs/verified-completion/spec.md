# Delta Spec: verified-completion

## Purpose

Defines the contract for final replies on degraded agent turns: when verification runs, how the verdict reflects what actually happened, which tools the verifier may use, and what the user is told when no verified text can be produced.

## ADDED Requirements

### Requirement: Risky turns are verified

When an agent turn ends with empty final assistant text, ends on a pending tool call (step cap), or contains a tool-failure result, the system SHALL run a constrained verification generation over the turn's message history to produce the user-facing final reply. Turns with confident non-empty text and no tool failure SHALL skip verification and deliver the model text unchanged.

#### Scenario: Empty-text turn

- **WHEN** the model returns empty final text on an interactive or proactive turn
- **THEN** a verification generation runs and its text becomes the delivered reply

#### Scenario: Confident turn

- **WHEN** the turn ends with non-empty text and no tool failure
- **THEN** no verification generation runs and the model text is delivered unchanged

### Requirement: Verdict reflects actual turn activity

The system SHALL derive the turn verdict from observable turn shape: `no-op` when the final text is empty and the turn produced no tool-result messages; `truncated` when the turn ended on a pending tool call; `partial` when any tool-result message carries a failure; `confirmed` otherwise. A turn where nothing was executed SHALL never be reported as `confirmed`.

#### Scenario: Nothing happened

- **WHEN** a turn ends with empty text and contains no tool-result messages
- **THEN** the derived verdict is `no-op`

#### Scenario: Tool work with a failure

- **WHEN** a turn executed tools and one result carries a failure payload
- **THEN** the derived verdict is `partial`

### Requirement: Last-resort messages are factually honest

When the verification generation fails or returns empty text, the system SHALL deliver a last-resort message chosen by the turn's actual activity, localized to the turn's configured language: a turn that executed at least one tool gets a message stating the actions ran but the result could not be confirmed; a turn that executed nothing gets a message stating nothing was executed and asking the user to repeat the request. The nothing-executed message SHALL NOT assert that any action was performed.

#### Scenario: Verifier empty after an active turn

- **WHEN** tools executed during the turn and the verifier returns no text
- **THEN** the delivered message says the actions ran but could not be confirmed

#### Scenario: Verifier empty after a no-op turn

- **WHEN** no tools executed during the turn and the verifier returns no text
- **THEN** the delivered message says nothing was executed and asks the user to repeat the request, and does not claim any action was performed

#### Scenario: Language follows the config context

- **WHEN** the turn's config context language is Russian (or English)
- **THEN** the last-resort message is delivered in that language

### Requirement: Verifier toolset is read-only and includes read-prefixed tools

The verification generation SHALL receive only tools that are read-only by construction: those whose names begin with `get_`, `list_`, `search_`, or `read_`, intersected with the tools already assembled and permission-gated for the turn. Mutating tools SHALL NOT be offered to the verifier. No new tool surface is created; a tool offered to the verifier keeps every permission wrapper it carries on the main path.

#### Scenario: Diagnostics readers are verifiable

- **WHEN** the turn's assembled toolset contains `read_`-prefixed diagnostics readers
- **THEN** the verifier can invoke them to re-check state referenced by the user's request

#### Scenario: Mutating tool excluded

- **WHEN** the turn's toolset contains create/update/delete tools
- **THEN** none of them is offered to the verification generation

### Requirement: Send logging reports the delivered text

When the final reply is sent, the system SHALL log the length of the text actually delivered to the chat (model text or verified/last-resort text) alongside the length of the model's own final text. The delivered length SHALL be nonzero whenever a non-empty reply was sent.

#### Scenario: Verifier text replaces empty model text

- **WHEN** the model's final text is empty and a 1200-character verified reply is delivered
- **THEN** the send log reports a delivered length of about 1200 and a model-text length of 0

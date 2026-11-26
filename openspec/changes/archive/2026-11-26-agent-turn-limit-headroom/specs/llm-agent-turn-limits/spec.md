## Purpose

Bounds how many LLM steps a single runtime agent turn can take, and makes hitting that bound precisely observable so cap-outs can be told apart from stalls, user stops, and natural completions in traces and logs.

## ADDED Requirements

### Requirement: Default agent turn step budget

The runtime agent turn loop SHALL limit a single turn to a default maximum of 125 LLM steps. When the budget is reached while the model is still requesting tool calls, the system SHALL end the turn at that boundary instead of continuing. The budget SHALL be a fixed default with no runtime override: no environment variable, no settings-UI field, and no per-context configuration key exists for it, so every agent turn — on any platform instance, in any chat context, in guest mode, or in a context with an unconfigured (null) task instance — runs under the same budget. The budget SHALL count all LLM steps of the turn, including steps executed after a mid-run steer injection; a steered continuation MUST NOT reset or extend the count. The no-progress guard SHALL continue to bound unproductive stalls independently of this budget.

#### Scenario: Budget ends a still-working turn
- **WHEN** an agent turn reaches 125 LLM steps and the model's latest step still requests tool calls
- **THEN** the turn ends at that boundary instead of running further steps

#### Scenario: Fixed default applies everywhere without configuration
- **WHEN** agent turns run on different platform instances, in guest mode, or in contexts with an unconfigured (null) task instance, and no budget-related configuration exists anywhere in the system
- **THEN** every such turn is bounded by the same 125-step default, with no per-instance or per-context override

#### Scenario: Steered continuation does not reset the budget
- **WHEN** a user steers a running agent turn at a tool-step boundary and the turn continues past the injection
- **THEN** the steered steps count toward the same turn's step budget rather than restarting it

### Requirement: Turn-limit marker on the turn-end event

Turn-end telemetry SHALL distinguish a step-budget cap-out from every other way a turn can end. When a turn ends because the step budget was exhausted, the turn's end event (`llm:end`) SHALL carry `stopReason: 'turn_limit'` together with the total step count. When a turn ends by any other means — the model producing its final response, a `/stop` graceful halt or force abort, or the no-progress guard — the event MUST NOT carry `stopReason: 'turn_limit'`. The marker SHALL be carried in event data only: no new analytics fact, database field, or persisted record SHALL be introduced for it.

#### Scenario: Cap-out is marked
- **WHEN** a turn ends because its step budget was exhausted
- **THEN** the turn's `llm:end` event carries `stopReason: 'turn_limit'` and the step count reached

#### Scenario: Natural completion is not marked
- **WHEN** a turn ends because the model produced its final response within the budget
- **THEN** the turn's `llm:end` event does not carry `stopReason: 'turn_limit'`

#### Scenario: User stop is not marked
- **WHEN** a turn ends through a `/stop` graceful halt or force abort
- **THEN** the turn's `llm:end` event does not carry `stopReason: 'turn_limit'`

#### Scenario: No-progress stall is not marked
- **WHEN** a turn ends through the no-progress guard before exhausting the step budget
- **THEN** the turn's `llm:end` event does not carry `stopReason: 'turn_limit'`

#### Scenario: Marker stays event-only
- **WHEN** a turn ends by exhausting the step budget
- **THEN** the marker appears only in the event data, and no new analytics fact or persisted database record is created for it

### Requirement: Precise cap-out warning log

When the step budget ends a turn, the system SHALL emit one structured warning log at the turn boundary naming the context id, the turn id, and the step count at which the budget fired. This warning SHALL fire only when the step budget actually ended the turn — never for a turn ending by final response, user stop, or the no-progress guard. The warning MUST NOT include message content, tool arguments or results, credentials, tokens, or any other sensitive data.

#### Scenario: Cap-out warning carries identifiers only
- **WHEN** a turn ends by exhausting the step budget
- **THEN** a structured warning is emitted naming the context id, turn id, and step count
- **AND** the warning contains no message content, tool arguments or results, credentials, or other sensitive data

#### Scenario: Warning is exclusive to budget cap-outs
- **WHEN** a turn ends by final response, a `/stop` halt, or the no-progress guard
- **THEN** no turn-limit warning is emitted for that turn

### Requirement: Cap-out follows the existing truncation flow

A turn ended by the step budget SHALL be handled exactly like any other turn that ends without a model final response: the existing risky-turn handling produces the user's reply with a `truncated` verdict and a summary offering continuation. The cap-out MUST NOT surface to the user as a new error message, failure state, or turn-limit-specific notice.

#### Scenario: User sees the existing truncation outcome
- **WHEN** a turn is ended by the step budget
- **THEN** the user receives the same truncation outcome other non-final turn endings receive — a summary offering to continue — with no new turn-limit-specific error or notice

### Requirement: Scope limited to the runtime agent turn loop

The default budget and the `turn_limit` marker SHALL apply only to the interactive runtime agent turn loop. The verifier sub-loop and the proactive loop SHALL keep their own step budgets unchanged, and events emitted for those loops MUST NOT carry `stopReason: 'turn_limit'`.

#### Scenario: Verifier and proactive budgets are unaffected
- **WHEN** the verifier sub-loop runs within its own smaller step budget, or the proactive loop ends at its own step cap
- **THEN** neither budget is changed by the agent turn default, and no event from either loop carries `stopReason: 'turn_limit'`

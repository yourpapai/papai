# Delta Spec: tool-calling-resilience

## Purpose

Keeps the agent tool-calling loop working when the model addresses tools that exist in the turn's registered toolset but are not active in the current progressive-disclosure step, and makes silently-degraded empty turns observable to operators.

## ADDED Requirements

### Requirement: Misdirected tool calls are repaired via activation

When the model issues a tool call whose name is registered in the turn's full toolset but absent from the current step's active set, the system SHALL rewrite that call into a call to the activation meta-tool (`load_tool`) with the requested name as its activation input, preserving the original call id. The rewritten call SHALL execute, activating the named tool for subsequent steps of the same turn. Calls to names that are not registered in the turn's toolset SHALL NOT be repaired and SHALL keep their existing error behavior. This SHALL apply to both the interactive chat generation path and the proactive (deferred prompt) generation path.

#### Scenario: Model calls a tool it used in a previous turn

- **WHEN** a turn starts with a fresh disclosure state and the model calls a tool that is registered in the turn's toolset but inactive in the current step
- **THEN** the system executes an equivalent `load_tool` activation for that name, the tool becomes active on the next step, and the turn continues instead of ending with an unanswered call

#### Scenario: Model calls an unregistered name

- **WHEN** the model calls a tool name that is not registered in the turn's toolset at all
- **THEN** no repair occurs and the existing tool-error feedback to the model is preserved

#### Scenario: Proactive delivery path

- **WHEN** a proactive (deferred prompt) generation exhibits a registered-but-inactive tool call
- **THEN** the same activation repair applies as on the interactive path

### Requirement: Repair cannot escalate the tool surface

The repair SHALL only activate names already present in the turn's registered toolset, respecting every capability and permission gate that produced that toolset (context gating, guest-mode read-only toolset, `tool_prefs` allow/ask/deny). The repair target itself SHALL be the always-active activation meta-tool, which no stored permission override can wrap or deny.

#### Scenario: Guest-mode turn

- **WHEN** a guest-mode user's model output calls a registered guest toolset name that is inactive
- **THEN** the repair activates only that name within the guest toolset and no tool outside it becomes invocable

#### Scenario: Permission-wrapped tool

- **WHEN** the repaired name resolves to a tool wrapped by an `ask` permission override
- **THEN** after activation the tool keeps its confirmation flow unchanged

### Requirement: Anomalous empty turns are logged

When a generation turn ends with empty final assistant text, zero tool calls across all steps, and billed output tokens at or above a fixed threshold, the system SHALL emit a warn-level log entry containing the output-token count and finish reason. The log SHALL contain no message content or tool payloads. Normal turns (non-empty text, or any tool call, or low token count) SHALL NOT produce this entry.

#### Scenario: Burned-tokens empty turn

- **WHEN** a turn completes with `stop`, an empty final message, no tool calls in any step, and hundreds of billed output tokens
- **THEN** a warn-level entry with the token count and finish reason is emitted exactly once for that turn

#### Scenario: Normal turn

- **WHEN** a turn ends with non-empty text or at least one tool call
- **THEN** no anomalous-empty-turn entry is emitted

### Requirement: Disclosure protocol warns that activations expire

The progressive-disclosure protocol text presented to the model SHALL state, in every supported UI language, that tool activations do not persist across turns and that a tool used in an earlier turn must be activated again before use.

#### Scenario: Protocol text content

- **WHEN** the system prompt is assembled for a turn with progressive disclosure enabled
- **THEN** the disclosure fragment includes the expiry warning in the turn's configured language

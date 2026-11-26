## Purpose

Lets a bot admin ask the bot, inside a direct-message conversation, to investigate the bot's own recent behavior through read-only chat tools that query the always-on in-process diagnosis buffers and egress their content under the per-admin visibility policy.

## ADDED Requirements

### Requirement: Self-diagnosis buffer readers are admin-gated

The system SHALL expose the four read-only self-diagnosis tools — `read_recent_logs`, `read_llm_traces`, `read_recent_turns`, `read_recent_tool_failures` — to a conversation only when the calling user is a recognized bot admin, the conversation is a direct message with the bot, and the bot is running in normal mode. The gate SHALL fail closed: whenever admin status, conversation type, or mode cannot be positively established, the tools SHALL be absent from the toolset. The gate SHALL evaluate identically on every chat platform instance. The tools SHALL never be part of a guest-mode toolset, SHALL never be provisioned for unrecognized users, and SHALL NOT be executed by display-only context-listing commands. Visibility shaping SHALL be computed against the invoking admin's own chat identity on every invocation, including invocations queued or coalesced behind other work.

#### Scenario: Admin DM in normal mode gets the full family
- **WHEN** a recognized bot admin interacts with the bot in a direct-message conversation while the bot is in normal mode
- **THEN** all four reader tools are available in that conversation's toolset

#### Scenario: Non-admin user gets nothing
- **WHEN** a user without bot-admin status interacts with the bot in a direct message
- **THEN** none of the four reader tools are available, and invoking one by name is refused

#### Scenario: Group conversations are excluded even for admins
- **WHEN** a recognized bot admin invokes the tools from a group conversation on any platform instance, including thread-scoped group contexts
- **THEN** none of the four reader tools are available

#### Scenario: Fail-closed on unknown admin status
- **WHEN** the bot cannot positively determine whether the calling user is a bot admin
- **THEN** the four reader tools are treated as absent for that conversation

#### Scenario: Guest mode never includes the readers
- **WHEN** a group with guest mode enabled receives its hardcoded read-only guest toolset
- **THEN** none of the four reader tools appear in that toolset and no guest is provisioned with them

#### Scenario: Identical gating across platform instances
- **WHEN** admins of equivalent status converse with the bot through different chat platform instances (Telegram, Mattermost, Discord, Kontur Talk)
- **THEN** the presence and absence of the four reader tools is identical in every instance

### Requirement: Log egress is attribution-shaped

The `read_recent_logs` tool SHALL return entries from the in-process log ring buffer, shaped per the calling admin's attribution. Entries attributable to the calling admin — including entries belonging to turns owned by that admin — SHALL pass through verbatim. Entries attributable to another user, or with no attribution, SHALL be reduced to structural fields plus numeric and boolean values only, dropping message bodies and other free-text content. The tool SHALL accept optional filters for minimum level, scope substring, turn id, and message text match, plus a result limit with a default of 50 and a hard cap of 200 entries. Every result SHALL include the buffer's entry count, capacity, and oldest/newest timestamps, and SHALL NOT treat message-text or scope filtering as applying to entries whose content was stripped by shaping beyond what the structural fields expose. A distinct-scopes mode SHALL return the set of distinct scope names recorded in the buffer instead of entries.

#### Scenario: Own entries pass verbatim
- **WHEN** the admin calls `read_recent_logs` and the buffer contains entries produced by that same admin's turns
- **THEN** those entries are returned with their full recorded content

#### Scenario: Foreign entries are shaped
- **WHEN** the buffer contains entries attributable to a different user
- **THEN** those entries are returned with only structural and numeric/boolean fields, and their message bodies and free-text content are absent

#### Scenario: Unattributed entries are shaped like foreign ones
- **WHEN** the buffer contains entries with no attribution
- **THEN** those entries are returned shaped exactly as foreign entries

#### Scenario: Shaping is per-caller
- **WHEN** two different admins query the same buffer contents from their respective direct messages
- **THEN** each admin sees their own entries verbatim and the other admin's entries shaped

#### Scenario: Filters and limits
- **WHEN** the admin supplies a minimum level, a scope substring, a turn id, or a message text match, together with a limit
- **THEN** only matching entries are returned, the count never exceeds the supplied limit, and a limit above the hard cap is capped at 200 without error

#### Scenario: Distinct scopes orientation query
- **WHEN** the admin requests distinct scopes
- **THEN** the tool returns the distinct scope names rather than log entries

### Requirement: LLM trace egress is attribution-shaped

The `read_llm_traces` tool SHALL return recent LLM call traces from the tail of the in-process trace buffer. Traces attributable to the calling admin SHALL pass through verbatim. Foreign or unattributed traces SHALL lose generated text, step-by-step detail, tool arguments, tool results, and identity fields, while retaining model identifiers, durations, token and step counters, tool names, and error information. The tool SHALL accept optional filters for errors-only and model identifier, plus a result limit with a default of 25 and a hard cap of 100, served from the most recent end of the buffer.

#### Scenario: Own traces pass verbatim
- **WHEN** the admin calls `read_llm_traces` and the buffer contains traces of that admin's own LLM calls
- **THEN** those traces are returned with their full recorded content including generated text, step detail, and tool arguments and results

#### Scenario: Foreign traces are stripped of content
- **WHEN** the buffer contains traces attributable to another user or to no user
- **THEN** those traces are returned without generated text, step detail, tool arguments, tool results, or identity fields, and still report model identifiers, durations, token and step counters, tool names, and errors

#### Scenario: Errors-only filter
- **WHEN** the admin requests errors only
- **THEN** only traces that carry an error are returned

#### Scenario: Tail slicing with cap
- **WHEN** the buffer holds more traces than the requested limit
- **THEN** the most recent traces up to the limit are returned, and a limit above the hard cap is capped at 100 without error

### Requirement: Turns, notifications, and tool failures are visibility-filtered

The `read_recent_turns` and `read_recent_tool_failures` tools SHALL exclude from listings any buffered record — turn, notification turn, or tool failure — whose conversation scope is not visible to the calling admin under the per-admin visibility policy. The `read_recent_turns` tool SHALL support an optional turn-status filter (`running`, `ok`, `error`, `cancelled`), an optional single-turn fetch by id, and a result limit with a default of 25 capped at the turn buffer's capacity. The `read_recent_tool_failures` tool SHALL return timestamp, scope, and the whitelisted failure classification fields (tool name, duration, success flag, failure reason, turn id) with a result limit defaulting to 25 and capped at the tool-failure buffer's capacity. A single-turn fetch for a turn id that is foreign, not visible, or unknown SHALL return a `not_found` status indistinguishable across those cases, so that existence of other users' turns is never disclosed. Turn and failure payloads that pass the visibility filter SHALL contain only anonymous operational data (timings, statuses, tool names and durations, failure reasons, error strings), never message content.

#### Scenario: Listings exclude invisible scopes
- **WHEN** an admin lists recent turns or recent tool failures and the buffers contain records whose scope is not visible to that admin
- **THEN** those records are absent from the listing

#### Scenario: Foreign turn id returns not_found
- **WHEN** the admin fetches a turn by an id that exists but belongs to a scope not visible to that admin
- **THEN** the tool returns a `not_found` status

#### Scenario: Unknown and foreign ids are indistinguishable
- **WHEN** the admin fetches one turn id that does not exist and another that exists but is foreign
- **THEN** both fetches return the same `not_found` result shape with no field distinguishing existence

#### Scenario: Status filter applies to visible turns
- **WHEN** the admin filters recent turns by a status such as `error`
- **THEN** only visible turns with that status are returned

#### Scenario: Visible records carry anonymous payloads
- **WHEN** a turn or tool-failure record passes the visibility filter
- **THEN** its egressed payload contains timings, statuses, tool names, durations, and failure or error strings, and contains no user message content

### Requirement: Readers expose buffer volatility honestly

Every reader result SHALL carry the queried buffer's statistics (entry count, capacity, and where applicable oldest/newest timestamps) and log results SHALL carry a marker stating that history begins at process start. After a process restart the buffers SHALL be reported as empty: readers SHALL return empty result sets with fresh statistics rather than erroring, and SHALL NOT present invented or stale pre-restart history.

#### Scenario: Stats accompany results
- **WHEN** the admin calls any of the four reader tools
- **THEN** the result includes the queried buffer's statistics alongside the entries

#### Scenario: Restart yields empty buffers, not errors
- **WHEN** the bot process has restarted and an admin queries any reader
- **THEN** the tool returns an empty result set with zero-count buffer statistics and completes successfully

#### Scenario: Pre-restart history is marked as unavailable
- **WHEN** log results are returned
- **THEN** they carry a marker indicating history starts at process start, so no pre-restart history is implied

### Requirement: Readers are read-only, secret-free, and preference-governed

The four reader tools SHALL NOT mutate any diagnosis buffer or bot state; in particular they SHALL never clear or drop buffered entries. Results and tool-invocation logs SHALL contain no secret material — never tokens, API keys, session cookies, or decrypted configuration bodies — and invocation logging SHALL be metadata-only (counts and limits, never entry bodies). A failing probe within a reader SHALL degrade to a structured per-probe error marker or structured tool-failure result, never an uncaught throw. Each tool SHALL be registered under the `diagnostics` read capability in the tool preference catalog, so the per-context `tool_prefs` three-state resolution applies: implicit `allow` by default, `deny` removes the tool from the set, and `ask` wraps each call in the confirmation flow requiring the admin's approval before execution.

#### Scenario: Buffers are unchanged after invocation
- **WHEN** any of the four reader tools is invoked
- **THEN** the queried buffers' contents and statistics are byte-identical before and after the invocation

#### Scenario: No secrets in results or logs
- **WHEN** a reader returns results over buffers that have processed credentials, and the invocation is logged
- **THEN** neither the results nor the log records contain tokens, API keys, session cookies, or decrypted configuration bodies, and the log carries only metadata such as counts and limits

#### Scenario: Probe failure degrades structurally
- **WHEN** an internal probe of a reader fails during execution
- **THEN** the tool returns a structured error marker or structured tool-failure result and the process continues without an uncaught exception

#### Scenario: Deny removes the tool
- **WHEN** a context's `tool_prefs` sets a reader tool to `deny`
- **THEN** that tool is absent from the toolset for that context

#### Scenario: Ask requires confirmation
- **WHEN** a context's `tool_prefs` sets a reader tool to `ask` and the admin invokes it
- **THEN** the bot presents a confirmation request and executes the tool only after the admin approves, and does not execute it when the admin declines

#### Scenario: Allow runs without confirmation
- **WHEN** a reader tool has no explicit preference or is set to `allow`
- **THEN** invocation proceeds directly without a confirmation step

# telegram-rich-outbound — delta spec

## ADDED Requirements

### Requirement: Rich-first rendering for LLM output

When a Telegram platform instance has rich rendering enabled, the adapter SHALL send
LLM markdown through the platform's rich-markdown message API (native tables,
headings, task lists, footnotes; 32,768-character capacity) on the three
markdown-bearing surfaces: formatted replies, deferred delivery sends, and in-place
reply edits. The stored markdown SHALL reach the API unmodified except for
audience/mention prefixes the entity path also applies.

#### Scenario: Table in an LLM reply

- WHEN rich rendering is enabled and the LLM reply contains a markdown table
- THEN the delivered message renders as a native table on current clients, not flattened rows

#### Scenario: Long reply

- WHEN rich rendering is enabled and the reply exceeds 4,096 characters but not the rich limit
- THEN the reply is delivered as a single rich message without chunking or failure

#### Scenario: Flag off

- WHEN the instance has rich rendering disabled
- THEN all sends behave exactly as before this change (entity path, existing preprocessing)

### Requirement: Non-masking fallback on rich-parse rejection

If the platform rejects a rich send because the payload fails rich parsing, the
adapter SHALL fall back to the existing entity path for that send. The adapter SHALL
NOT fall back for rate-limit, authorization, chat-forbidden, or network errors —
those take their existing handling, because an entity send would fail identically.
A rejected-then-retried fallback counts as one rich attempt and one fallback.

#### Scenario: Parse rejection

- WHEN the API rejects the rich payload with a content/parse error
- THEN the same content is sent through the entity path and the user receives the reply

#### Scenario: Rate limit

- WHEN the rich send fails with a rate-limit error
- THEN no entity fallback is attempted for that send and the error follows existing handling

#### Scenario: Edit fallback

- WHEN an in-place edit is rejected for rich parsing
- THEN the edit is retried once with plain text and entities for the same content

### Requirement: Fallback observability

Every fallback SHALL emit a structured log event identifying the instance, surface,
and rejection reason, and the adapter SHALL expose cumulative counters (attempts,
fallbacks, last rejection reason) through the debug-server state snapshot. No user
identifiers SHALL appear in these counters.

#### Scenario: Snapshot after fallback

- WHEN a fallback has occurred since process start
- THEN the debug state snapshot reports the attempts/fallbacks counts and the last rejection reason

### Requirement: Rollout gating

Rich rendering SHALL default to disabled. Switching the default to enabled SHALL be
a config/data change requiring no deploy, and per-instance opt-out SHALL remain
effective after the default flips.

#### Scenario: Operator toggle

- WHEN an operator enables rich rendering for one Telegram instance in the settings UI
- THEN only that instance's sends go rich-first; other instances are unaffected

#### Scenario: Rollback without deploy

- WHEN rich rendering is disabled for an instance after having been enabled
- THEN subsequent sends use the entity path immediately, with no restart required

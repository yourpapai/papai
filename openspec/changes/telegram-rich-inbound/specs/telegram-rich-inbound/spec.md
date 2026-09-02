# telegram-rich-inbound — delta spec

## ADDED Requirements

### Requirement: Rich message intake

The Telegram adapter SHALL accept incoming updates whose message carries a rich
message (`rich_message` set) and deliver them through the standard message pipeline
as text messages, exactly as plain-text messages of the same scope are delivered.

#### Scenario: Rich message in a direct message

- WHEN a user sends a rich message (no `text` field, `rich_message` set) to the bot in a DM
- THEN the adapter extracts plain text from the rich message and delivers it as an `IncomingMessage` with that text and `contextType` `dm`

#### Scenario: Rich message in a group

- WHEN a user sends a rich message into a group where the bot observes all messages
- THEN the adapter extracts plain text and applies the same mention/isReplyToBot routing rules as a plain-text group message

#### Scenario: Rich message in a forum thread

- WHEN a rich message arrives in a forum thread
- THEN the extracted text is delivered with the same thread-scoped storage context id resolution as a plain-text message in that thread

#### Scenario: Guest user sends a rich message

- WHEN an unrecognized user in a guest-mode group sends a rich message
- THEN the message is intaken through the same path as their plain-text messages and is subject to the same guest read-only toolset — no additional gating is introduced by the rich format

### Requirement: Rich message edits are observed

The adapter SHALL treat `edited_message` updates carrying `rich_message` as message
edits whose new text is the re-extracted plain text, mirroring plain-text edit
handling.

#### Scenario: User edits a rich message

- WHEN a user edits a previously sent rich message
- THEN the adapter delivers the edit with `editedAt` set and the re-extracted text, and the message-edit handling behaves as it would for an edited plain-text message

### Requirement: Plain-text extraction contract

Extraction from a received rich message SHALL produce plain text only: styled inline
nodes are concatenated, and text-bearing blocks (paragraphs, headings, preformatted,
list items, quotations) contribute their text in document order. Formatting is not
preserved. A rich message whose extraction yields no text SHALL NOT be delivered as a
text message.

#### Scenario: Document with table and headings

- WHEN a rich message contains a heading, a paragraph, and a table
- THEN the extracted text contains the heading text, paragraph text, and table cell text in order, with no markdown or formatting syntax added

#### Scenario: Media-only rich message

- WHEN a rich message contains only media blocks and no text-bearing blocks
- THEN the update is not delivered as a text message (media inside rich messages is declined scope)

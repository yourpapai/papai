<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mattermost Mention-Prefixed Command Syntax — Design

**Date:** 2026-05-28
**Status:** Approved design, pending implementation plan
**Author:** brainstorming session

## Problem

The current Mattermost provider pretends slash commands are ordinary message text. It stores
registered commands in-memory and matches incoming WebSocket post text that starts with `/`.
That does not align with how Mattermost actually handles native slash commands.

In practice, this creates a broken user experience:

- typing `/config` or similar hits Mattermost's native slash-command resolver first
- because papai has not registered real Mattermost custom slash commands, the user gets
  “command not found” from Mattermost
- papai's local `/command` parser is therefore only accidentally useful for message flows that
  never become real slash commands

The user explicitly chose not to implement real Mattermost custom slash command integrations
in this project. Instead, Mattermost command syntax should be honest, explicit, and based on
plain message parsing.

## Goals

- Standardize Mattermost command syntax on plain messages of the form `@papai /command`.
- Use the same syntax in both Mattermost DMs and channels.
- Remove support for bare `/command` parsing in the Mattermost provider.
- Keep existing provider-agnostic command handlers unchanged where possible.
- Preserve normal mention-based natural-language behavior for non-command messages.
- Use `@papai /help` as the primary command discovery mechanism.

## Non-Goals

- No implementation of native Mattermost custom slash-command registration.
- No autocomplete or other provider-native slash discovery.
- No fallback support for bare `/command` after the change.
- No redesign of command handlers themselves.
- No attempt to unify Mattermost syntax with Telegram publication behavior.

## Existing Architecture

- `MattermostChatProvider` listens to WebSocket `posted` events and builds `IncomingMessage`
  values from regular posts.
- It currently calls `matchCommand(post.message)` and treats leading `/command` text as a
  command, even though real Mattermost slash commands never arrive through this path.
- The general bot architecture already distinguishes between command messages and
  mention-addressed natural-language messages through `msg.commandMatch` and `msg.isMentioned`.
- Group noise is ignored unless the message is a command or mentions the bot.

## Design

### 1. Supported Mattermost command syntax

The only supported Mattermost command form becomes:

```text
@papai /command arguments...
```

This applies everywhere:

- direct messages
- public channels
- private channels
- thread replies where mention-based message handling already applies

Bare `/command` is no longer a supported papai command form in Mattermost. If a user types
bare `/config`, Mattermost may reject it or route it elsewhere, and papai will not try to
recover or emulate support for it.

### 2. Message normalization before command matching

The Mattermost adapter should gain an explicit normalization step before command matching.
That normalization is provider-local and should not leak Mattermost-specific rules into the
shared command handlers.

Normalization responsibilities:

- detect whether the bot was mentioned
- require that the bot mention be the first non-whitespace token for command routing
- strip the leading bot mention from the message when present
- trim the remaining text without altering its semantic content
- classify the normalized remainder as either:
  - command text if it begins with `/`
  - mention-addressed natural-language text otherwise
  - non-actionable noise if there is no bot mention and no supported command form

After normalization, `msg.text`, `msg.isMentioned`, and `msg.commandMatch` must stay
internally coherent for downstream logic.

Concretely:

- `@papai /config foo` becomes a command with normalized command text `/config foo`
- `@papai summarize this thread` remains a mention-addressed natural-language message
- `/config` is not treated as a papai command at all

### 3. Remove legacy bare-slash fallback

The current bare `/command` parser must be removed rather than preserved as compatibility
fallback.

This is intentional for three reasons:

- it is not a truthful model of Mattermost behavior
- it creates ambiguous support expectations around native slash commands
- keeping it undocumented would still produce accidental hidden behavior and future confusion

After the change, all Mattermost command routing should depend on mention-prefixed syntax.

### 4. Discovery model

Discovery is intentionally minimal.

Primary discovery path:

```text
@papai /help
```

No extra in-product affordances are required in this design. No autocomplete is expected.
No alias like `@papai help` is added. The command surface is discoverable through the help
command and user documentation, but the runtime design itself treats `@papai /help` as the
canonical entry point.

### 5. Preserve provider-agnostic handler logic

This design changes Mattermost input parsing, not command semantics.

The command handlers under `src/commands/` should continue to receive normal `IncomingMessage`
values and should not learn anything about Mattermost mention stripping.

That means the Mattermost adapter owns:

- mention detection
- mention stripping
- command classification
- removal of the legacy bare-slash path

The shared command layer continues to own:

- authorization
- command-specific usage text
- DM-only and group-only enforcement
- actual business behavior

## Testing Strategy

Required unit coverage:

- `@papai /config` in a DM routes to the config command handler
- `@papai /config` in a channel routes to the config command handler, which may then enforce
  its existing behavior
- bare `/config` does not route to papai command handlers
- `@papai some natural language request` still behaves like a normal mention-addressed
  non-command message
- normalization preserves correct `commandMatch` extraction after the mention is removed
- messages without mention and without command syntax remain ignored as normal group noise

The tests should focus on observable provider behavior, not just helper internals.

## Error Handling And Behavioral Rules

- There is no backward-compatibility fallback for bare `/command`.
- If a user mentions the bot and sends only the mention with no content, papai should reply
  with short guidance such as "Use `@papai /help` to see commands, or mention me with a
  question." It should not silently enqueue an empty request.
- Mention stripping should be strict enough to avoid accidental command routing when the bot
  is not the addressed recipient.

## Consequences

### Positive

- Mattermost command syntax becomes honest and consistent with the user's chosen product
  direction.
- There is no more conflict between papai's pretend slash commands and Mattermost's native
  slash-command resolver.
- The change stays localized to the Mattermost adapter instead of forcing handler rewrites.

### Negative

- Native slash autocomplete is gone by design.
- Existing users who relied on accidental bare `/command` parsing will need to switch to the
  mention-prefixed syntax.
- Mattermost command syntax now differs intentionally from Telegram's native slash menu model.

## Implementation Shape

Expected code touch points:

- `src/chat/mattermost/index.ts` for message normalization and command matching changes
- Mattermost unit tests covering command recognition and natural-language mention behavior
- possibly small helper extraction under `src/chat/mattermost/` if normalization logic would
  otherwise make `index.ts` harder to follow

## Open Design Decision Resolved In This Spec

During brainstorming, the user confirmed:

- do not implement real Mattermost custom slash commands
- require `@papai /command` everywhere, including DMs
- remove bare `/command` support entirely
- use `@papai /help` as the primary discovery path
- treat autocomplete as out of scope

This document treats those decisions as fixed input for the implementation plan.

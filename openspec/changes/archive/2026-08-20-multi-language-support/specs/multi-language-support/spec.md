<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets each config context choose the bot's response language (English or Russian) so that every user-facing text the bot emits — command replies, acknowledgements and errors, tool progress lines, and system-prompt fragments — renders in the selected language from checked-in locale catalogs.

## ADDED Requirements

### Requirement: Language preference storage and default

The system SHALL store a `language` preference per config context with
allowed values `en` and `ru`, and SHALL treat a context with no stored
language as `en`. The preference SHALL be editable in the settings web UI
profile section as a select over the supported languages, and any value
outside the supported set SHALL be rejected by config validation.

#### Scenario: Unset context defaults to English

- **WHEN** a context has no stored language preference
- **THEN** the bot renders framework texts in English and the settings UI shows the preference as English

#### Scenario: Setting the language in the settings UI

- **WHEN** the launcher saves `ru` as the language preference of a config context
- **THEN** subsequent bot output for that config context renders in Russian

#### Scenario: Invalid value rejected

- **WHEN** a config update attempts to store a language value other than `en` or `ru`
- **THEN** the update is rejected with a validation error and the previously stored value is unchanged

### Requirement: Group-shared language scope

The language preference SHALL be scoped to the config context: all threads
of a group share one language, and each DM context has its own. Language
SHALL NOT be part of thread-isolated live conversation state.

#### Scenario: Change in one group thread applies to sibling threads

- **WHEN** the language is set to `ru` from one thread of a group
- **THEN** bot replies in every other thread of the same group also render in Russian

#### Scenario: DM language is independent

- **WHEN** a group's language is `ru` and a member's DM context language is `en`
- **THEN** the member's DM replies render in English while the group's replies render in Russian

### Requirement: First-interaction language picker

While no language is stored for a context, the system SHALL present a
language picker with one interactive button per supported language on
`/start` and on the first authorized message of that context, alongside
normal handling. Activating a picker button SHALL persist the chosen
language as the context's preference. The picker SHALL NOT be presented on
subsequent ordinary messages, whether or not the earlier picker was
answered; the language stays editable in the settings web UI.

#### Scenario: Picker shown on first interaction

- **WHEN** an authorized user sends the first message in a context with no stored language
- **THEN** the bot presents a two-button language chooser alongside normal handling of that message

#### Scenario: Choice persists

- **WHEN** the user activates a picker button
- **THEN** the selected language is stored for the config context and all subsequent bot output renders in it

#### Scenario: Unanswered picker does not repeat

- **WHEN** the picker was shown and the user sends another ordinary message without choosing
- **THEN** no picker is presented and output continues in the default language until a choice is made via the picker or the settings web UI

#### Scenario: /start with a stored language

- **WHEN** a user runs `/start` in a context whose language is already stored
- **THEN** the welcome text renders in the stored language and no picker is presented

### Requirement: Framework texts render in the selected language

Every user-facing framework text the bot emits — command replies,
acknowledgements, error and unauthorized replies, tool started/finished
progress lines, stop and steering acknowledgements, and bot-authored
announcement texts — SHALL be rendered in the context's selected language,
and each message SHALL contain text from exactly one language, never both.

#### Scenario: Russian context receives Russian command reply

- **WHEN** a user in a `ru` context runs `/help`
- **THEN** the reply is the Russian rendering of the help text

#### Scenario: Progress lines follow the language

- **WHEN** a tool executes in a `ru` context with tool-progress output enabled
- **THEN** the started/finished progress lines render in Russian

#### Scenario: Unauthorized replies follow the language

- **WHEN** an unauthorized user messages a group whose language is `ru`
- **THEN** the authorization-failure reply renders in Russian

### Requirement: Missing-translation fallback

When a text is missing from the selected language's catalog, the system
SHALL emit the English rendering of that text and log a warning naming
the missing entry. A raw message key SHALL never be delivered to users.

#### Scenario: Missing key falls back to English

- **WHEN** a framework text has no entry in the Russian catalog at runtime
- **THEN** the English text is delivered to the user and a warning is logged

### Requirement: System prompt locale and reply-language instruction

The system prompt — core sections, context fragments, and deferred
fragments — SHALL be assembled in the selected language and SHALL instruct
the model to write its free-text replies in the selected language
regardless of the language of the user's message.

#### Scenario: Model instructed to reply in the configured language

- **WHEN** a turn runs in a context with language `ru` and the user writes in English
- **THEN** the system prompt is assembled from Russian fragments and directs the model to answer in Russian

#### Scenario: Default English instruction

- **WHEN** a turn runs in a context with no stored language
- **THEN** the system prompt is assembled from English fragments and directs the model to answer in English

### Requirement: Uniform behavior across platforms, guests, and task configuration

Localized rendering SHALL behave identically across every platform
instance (Telegram, Mattermost, Discord, Kontur Talk). Guest-mode users
SHALL receive the group's configured language without being provisioned
as members. Localization SHALL NOT depend on a task instance being
assigned to the context.

#### Scenario: Guest-mode user

- **WHEN** a guest-mode user interacts in a group whose language is `ru`
- **THEN** framework texts and the reply-language instruction render in Russian and the guest is not provisioned as a member

#### Scenario: Unconfigured task instance

- **WHEN** a context with language `ru` has no task instance assigned
- **THEN** framework texts still render in Russian

#### Scenario: Platform parity

- **WHEN** the same `ru` config context converses over two different platform instances
- **THEN** both instances render framework texts in Russian

### Requirement: Catalog completeness and extensibility

Every framework text SHALL exist in the English catalog, and each
additional language catalog SHALL cover the same set of texts, enforced by
an automated parity check. Supporting a new language SHALL require only a
new catalog and a new preference option, with no changes at the places
that emit the texts.

#### Scenario: Parity check failure

- **WHEN** the Russian catalog is missing a key present in the English catalog
- **THEN** the automated parity check fails

#### Scenario: Catalog shape deviation

- **WHEN** a non-English catalog deviates from the English catalog's structure
- **THEN** the automated catalog validation fails before the change ships

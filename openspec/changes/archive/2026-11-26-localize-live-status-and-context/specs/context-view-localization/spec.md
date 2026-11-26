<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Renders the `/context` diagnostic view — section labels, detail strings, and per-platform renderer chrome — in the conversation's configured language while keeping the view's structure, emoji legend, and number formatting identical across languages.

## ADDED Requirements

### Requirement: /context renders in the context language

Section labels, detail strings, and renderer chrome of the `/context` view
SHALL render in the config context's selected language. Contexts with no
stored language SHALL render exactly the current English view,
byte-identical to the pre-change output.

#### Scenario: Russian section labels

- **WHEN** `/context` runs in a context whose language is `ru`
- **THEN** every section label renders in Russian (header beginning
  `Контекст · …`) and no English section label remains

#### Scenario: Localized detail strings

- **WHEN** `/context` renders memory facts, conversation history, and
  progressively disclosed tool sections in a `ru` context
- **THEN** the detail strings render as `{count} фактов`,
  `{count} сообщений`, and
  `{active} активных · {available} доступных (прогрессивное раскрытие)`

#### Scenario: Localized renderer chrome

- **WHEN** `/context` renders in a `ru` context on any platform
- **THEN** the header word (`Контекст`), the token-count unit (`токенов`),
  the token-column suffix, the approximate markers (`(приблизительно)`),
  and the footer disclaimer (`_количество токенов приблизительное_`) render
  in Russian

#### Scenario: English view unchanged

- **WHEN** `/context` runs in a context with no stored language (or `en`)
- **THEN** the rendered output is byte-identical to the pre-change English
  view, including labels, details, chrome, and number formatting

### Requirement: Section identity is independent of display language

Section-to-emoji mapping (the legend) SHALL key on stable machine section
identifiers, not on display labels, so every section carries the same emoji
in every language and translating labels cannot break the legend.

#### Scenario: Emoji legend correct in Russian

- **WHEN** `/context` renders in a `ru` context
- **THEN** each section shows the same emoji it shows in the English view
  and the legend enumerates the same section-to-emoji pairs as in English

### Requirement: Number formatting is language-independent

Token counts in the `/context` view SHALL keep `en-US` digit grouping
regardless of the selected language.

#### Scenario: Grouping preserved in the Russian view

- **WHEN** `/context` renders a token count of 12345 in a `ru` context
- **THEN** the count is formatted with comma grouping (`12,345`), not with
  space or period grouping

### Requirement: Platform parity and scope of the localized view

The localized `/context` view SHALL render consistently across Telegram,
Mattermost, Discord, and Kontur Talk instances of the same config context,
resolve its language from the config context (shared by all threads of a
group, independent per DM), reach guest-mode users in the group's language,
and not depend on a task instance being assigned.

#### Scenario: Same context, two platforms

- **WHEN** `/context` runs in the same `ru` config context on two different
  platform instances
- **THEN** both views render Russian labels, details, and chrome

#### Scenario: Guest-mode user

- **WHEN** a guest-mode user runs `/context` in a group whose language is
  `ru`
- **THEN** the view renders in Russian and the guest is not provisioned as
  a member

#### Scenario: Unconfigured task instance

- **WHEN** `/context` runs in a `ru` context with no task instance assigned
- **THEN** the view renders in Russian

### Requirement: Catalog coverage and fallback for /context texts

Every `/context` label, detail format, and chrome string SHALL exist in
every supported language catalog, with the gap caught by the catalog parity
enforcement before shipping. A key missing at runtime SHALL fall back to its
English rendering with a logged warning naming the missing entry, and a raw
catalog key SHALL never be displayed to users.

#### Scenario: Runtime fallback to English

- **WHEN** a `/context` text is missing from the selected language's
  catalog at runtime
- **THEN** the English text is displayed and a warning naming the missing
  entry is logged

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Renders the ephemeral live-status messages a chat platform shows while a turn is being processed — the thinking placeholder, per-tool activity lines, and the preparing-response placeholder — in the conversation's configured language, so the last chat surface that ignored the context language no longer mixes English into localized contexts.

## ADDED Requirements

### Requirement: Live-status texts follow the context language

The thinking placeholder, the preparing-response placeholder, and every
per-tool activity line SHALL render in the config context's selected
language. Contexts with no stored language SHALL render exactly the current
English strings, byte-identical to the pre-change output.

#### Scenario: Russian thinking placeholder

- **WHEN** a turn starts in a context whose language is `ru`
- **THEN** the initial status renders `💭 Думаю…` instead of `💭 Thinking…`

#### Scenario: Russian preparing-response placeholder

- **WHEN** the tool phase of a turn ends in a `ru` context
- **THEN** the placeholder status renders `💬 Готовлю ответ…` instead of
  `💬 Preparing response…`

#### Scenario: Registered tool label localized

- **WHEN** a tool with a registered label (for example task search) starts
  in a `ru` context
- **THEN** its activity line uses the Russian catalog label (for example
  `🔍 Ищу задачи…`) instead of the English registry label

#### Scenario: Default contexts keep English byte-identical

- **WHEN** a context has no stored language (or stores `en`) and a turn runs
- **THEN** every live-status text renders exactly as before the change
  (for example `💭 Thinking…`, `💬 Preparing response…`,
  `🕒 Checking the time…`), byte-identical to the prior English output

### Requirement: Unknown-tool fallback is localized

A tool without a registered label SHALL produce a generic running line in
the context's language, naming the tool in its human-readable form.

#### Scenario: Unregistered tool in a Russian context

- **WHEN** a tool with no registered label starts in a `ru` context
- **THEN** the status renders the localized generic line
  `⚙️ Выполняю <humanized tool name>…`, not the English
  `⚙️ Running <humanized tool name>…`

### Requirement: Locale-neutral status formatting

Only the words SHALL be translated. Emoji glyphs, argument rendering
(host-only arguments versus quoted argument text), argument truncation
limits, and the `(+n)` suffix appended while tools run in parallel SHALL be
identical across languages.

#### Scenario: Argument formatting unchanged in Russian

- **WHEN** a tool with a host or quoted-string argument runs in a `ru`
  context
- **THEN** the argument is rendered, quoted, and truncated exactly as in the
  English rendering, and only the leading label text is Russian

#### Scenario: Parallel-run suffix is not translated

- **WHEN** additional tools start while one is already running in a `ru`
  context
- **THEN** the status carries the same `(+n)` suffix it would carry in an
  English context

### Requirement: Language scope and reach of localized statuses

The live-status language SHALL resolve from the config context: shared by
all threads of a group and independent per DM context, matching the scope
of every other localized framework text. Localized statuses SHALL behave
identically across every platform instance (Telegram, Mattermost, Discord,
Kontur Talk), SHALL reach guest-mode users in the group's language, and
SHALL NOT depend on a task instance being assigned to the context.

#### Scenario: Sibling threads share the group's status language

- **WHEN** a group's language is `ru` and a turn runs in any thread of that
  group
- **THEN** that thread's live statuses render in Russian

#### Scenario: Platform parity

- **WHEN** the same `ru` config context runs a turn over two different
  platform instances
- **THEN** both instances render live statuses in Russian

#### Scenario: Guest-mode user

- **WHEN** a guest-mode user triggers a turn in a group whose language is
  `ru`
- **THEN** the live statuses (including labels of the guest read-only
  toolset) render in Russian and the guest is not provisioned as a member

#### Scenario: No task instance configured

- **WHEN** a `ru` context has no task instance assigned and a turn starts
- **THEN** the live statuses still render in Russian

### Requirement: Catalog coverage and fallback for live-status texts

Every live-status text — both placeholders, the generic running line, and
one label per registered tool — SHALL exist in every supported language
catalog, with the gap caught by the catalog parity enforcement before
shipping. A key missing at runtime SHALL fall back to its English rendering
with a logged warning naming the missing entry, and a raw catalog key SHALL
never be displayed to users.

#### Scenario: Parity enforcement blocks a partial catalog

- **WHEN** a non-English language catalog omits any live-status key present
  in the English catalog
- **THEN** the automated catalog parity check fails so the gap cannot ship

#### Scenario: Runtime fallback to English

- **WHEN** a live-status key is missing from the selected language's catalog
  at runtime
- **THEN** the English text is displayed and a warning naming the missing
  entry is logged

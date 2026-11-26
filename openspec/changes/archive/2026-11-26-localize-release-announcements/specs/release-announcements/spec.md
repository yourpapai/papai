<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Delivers each version release announcement in the recipient's configured language: one humanized body per supported locale is generated once from the changelog and stored per locale, and every opt-in subscriber — DM or group — receives the body matching their config-context language, with English as the fallback.

## ADDED Requirements

### Requirement: Per-locale announcement generation

When a new version is detected, the system SHALL generate one humanized
announcement body per supported language (English and Russian) from the
version's changelog section. Both bodies SHALL be derived from a single
shared selection of user-relevant entries, so the locales announce the same
changes. Each body SHALL be written in its own language, including its
section headers. When no entries survive selection, each locale's body
SHALL be that locale's behind-the-scenes one-liner rather than the raw
changelog. Bodies SHALL be generated only at announcement-detection time;
delivering to recipients SHALL NOT trigger any per-recipient generation.

#### Scenario: Both locales from one entry selection

- **WHEN** a new version's changelog section is humanized
- **THEN** an English body and a Russian body are produced, both derived
  from one shared selection of user-relevant entries, so the two locales
  announce the same set of changes

#### Scenario: Russian body is fully Russian

- **WHEN** the Russian body is generated
- **THEN** its prose and its section headers are in Russian, not English
  text reused for Russian recipients

#### Scenario: Empty release yields the localized one-liner

- **WHEN** no changelog entries survive relevance selection
- **THEN** each locale's body is that locale's behind-the-scenes
  one-liner, and neither locale receives the raw changelog section

#### Scenario: No per-recipient generation at broadcast

- **WHEN** the announcement is broadcast to any number of recipients
- **THEN** every delivered body comes from the bodies stored at
  announcement-detection time and no language-model call is made per
  recipient

### Requirement: Per-locale generation failure isolation

A failure to generate one locale's body SHALL be isolated to that locale:
the system SHALL log a warning naming the locale, fall back to the English
body for that locale's recipients, and continue the announcement lifecycle
(draft persistence, admin notice, later broadcast) for the other locales
unaffected.

#### Scenario: Russian write pass fails

- **WHEN** generation of the Russian body fails or returns empty output
- **THEN** the English body is still stored and later broadcast, a
  warning naming the Russian locale is logged, and the failure neither
  nulls out nor blocks the announcement

### Requirement: Per-locale body storage and legacy compatibility

The system SHALL store one humanized body per supported language for each
version announcement. Announcements created before per-locale storage
carried a single body; that legacy body SHALL be treated as the English
body wherever a locale-specific body is read. Historical announcements
SHALL NOT be backfilled, re-humanized, or re-broadcast as part of adopting
per-locale storage, and applying the storage upgrade SHALL be idempotent
and SHALL NOT alter previously stored announcement content.

#### Scenario: Legacy single-body announcement reads as English

- **WHEN** an announcement stored with only the legacy single body is
  viewed or broadcast
- **THEN** that body serves as the English body, and recipients whose
  language matches no stored body fall back to it

#### Scenario: No historical re-broadcast

- **WHEN** the per-locale storage upgrade is applied
- **THEN** already-announced versions are neither re-announced at
  startup, re-humanized, nor re-broadcast

#### Scenario: Storage upgrade is idempotent

- **WHEN** the storage upgrade runs more than once against the same
  database
- **THEN** announcement data remains intact and no duplicate storage is
  created

### Requirement: Recipients receive the body in their configured language

At broadcast time the system SHALL resolve each recipient's language from
their config context — a DM recipient from their own DM context's language
setting, a group recipient from the group's group-shared language setting
(one language for all threads of the group) — and SHALL deliver that
locale's body. A recipient with no stored language (or a value outside the
supported set) SHALL receive the English body. Per recipient the body
SHALL be resolved with the fallback chain: recipient-locale body, then
English body, then the raw changelog section. Localized delivery SHALL
behave identically across every platform instance and SHALL NOT depend on
a task instance being assigned to any context.

#### Scenario: Russian DM subscriber receives the Russian body

- **WHEN** an opt-in subscriber's DM context language is `ru` and a
  Russian body exists
- **THEN** the announcement DM delivers the Russian body

#### Scenario: Subscribed group receives the group's language

- **WHEN** a subscribed group's language is `ru` and a Russian body exists
- **THEN** the group receives one announcement in Russian, and the
  group's shared language applies to all of its threads

#### Scenario: Unset or English recipients receive English

- **WHEN** a recipient has no stored language or stores `en`
- **THEN** the delivered body is the English body

#### Scenario: Missing locale body falls back to English

- **WHEN** a recipient's language is `ru` but no Russian body was stored
- **THEN** the recipient receives the English body

#### Scenario: No humanized body falls back to the raw section

- **WHEN** no humanized body exists for any locale but a raw changelog
  section is stored
- **THEN** recipients receive the raw changelog section

#### Scenario: DM language independent of group language

- **WHEN** a user's DM context language is `en` while their group's
  language is `ru`
- **THEN** their DM delivers the English body and the group delivers the
  Russian body

#### Scenario: Platform parity

- **WHEN** the same broadcast reaches subscribers of the same configured
  languages across different platform instances
- **THEN** each subscriber receives the body matching their configured
  language on every platform instance

### Requirement: Delivery invariants preserved under localization

Localizing the delivered body SHALL NOT change the delivery contract: a
recipient already recorded as successfully delivered for a version SHALL
be skipped on any re-broadcast regardless of locale; a send failure for
one recipient SHALL be recorded for that recipient only and SHALL NOT
prevent delivery to the remaining recipients; and only opt-in subscribers
SHALL receive the announcement.

#### Scenario: Re-broadcast skips already-delivered recipients

- **WHEN** a broadcast is repeated for the same version after some
  recipients were successfully delivered
- **THEN** those recipients are skipped while remaining recipients still
  receive their language's body

#### Scenario: One recipient's failure does not block others

- **WHEN** delivery to one recipient fails or throws
- **THEN** the failure is recorded for that recipient only and every
  other recipient still receives their language's body

### Requirement: Admin review notice follows the admin's language

The startup review notice DM to the admin SHALL carry the announcement
body matching the admin's own config-context language, falling back to
the English body, then the raw changelog section. The notice wrapper
text SHALL render in the admin's language as it already does.

#### Scenario: Russian admin gets the Russian body

- **WHEN** the admin's context language is `ru` and a Russian body exists
- **THEN** the startup review DM wraps the Russian body in the Russian
  notice text

#### Scenario: Admin fallback when the locale body is missing

- **WHEN** the admin's context language is `ru` but no Russian body was
  stored
- **THEN** the review DM carries the English body (or the raw section)
  inside the Russian notice text

### Requirement: Admin per-locale review and editing

The settings Release notes admin surface SHALL show one body per
supported language for the current version. Its save and regenerate
actions SHALL accept the locale being acted on and SHALL change only that
locale's body, leaving the other locale's body untouched. Broadcast SHALL
remain a single action that fans out per-recipient localized bodies. All
actions SHALL remain admin-only (reads behind admin read access, mutations
behind admin write access with CSRF protection), and a request naming a
locale outside the supported set SHALL be rejected with a validation
error and change nothing.

#### Scenario: View returns per-locale bodies

- **WHEN** an admin opens the Release notes section
- **THEN** the response reports the body stored for each supported
  locale (or its absence) alongside the broadcast timestamp and
  subscriber counts

#### Scenario: Save edits one locale only

- **WHEN** the admin saves an edited body for locale `ru`
- **THEN** only the Russian body changes and the English body is
  untouched

#### Scenario: Regenerate replaces one locale only

- **WHEN** the admin regenerates the body for locale `en`
- **THEN** only the English body is replaced and the Russian body is
  untouched

#### Scenario: Unsupported locale rejected

- **WHEN** a save or regenerate request names a locale outside the
  supported set
- **THEN** the request is rejected with a validation error and no body
  changes

#### Scenario: Broadcast sends each recipient their language

- **WHEN** the admin triggers broadcast from the Release notes section
- **THEN** each opt-in subscriber receives the body matching their
  configured language per the delivery requirement

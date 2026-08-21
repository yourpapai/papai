## Purpose

Lets every opt-in release-announcement subscriber receive the humanized release notes in their own configured language: one humanized body is produced per supported locale, stored per version, and delivered per recipient with English-then-raw fallback.

## ADDED Requirements

### Requirement: Per-locale humanized generation

When a new version's announcement draft is created, the system SHALL humanize the extracted changelog section into one body per locale in the supported set (`en`, `ru`), generating for every supported locale regardless of which locales current subscribers use. The English body SHALL remain the authoritative default body. The decision of which changelog entries survive humanization SHALL be made once and shared by all locales, so per-locale bodies differ in language only, not in content selection.

#### Scenario: Draft carries a body per supported locale
- **WHEN** a new version is detected and an announcement draft is created
- **THEN** the draft persists a humanized English body and a humanized Russian body covering the same set of surviving changelog entries

#### Scenario: Entry selection is locale-independent
- **WHEN** the humanizer drops changelog entries as having no end-user value
- **THEN** the same entries are dropped for every locale, and no locale's body includes an entry that another locale's body omits

#### Scenario: Zero surviving entries yields a localized one-liner
- **WHEN** every changelog entry is dropped during humanization
- **THEN** each locale's body is that locale's catalog rendering of the behind-the-scenes one-liner, never the raw changelog

#### Scenario: Central LLM unconfigured
- **WHEN** no central LLM is configured at draft creation
- **THEN** no humanized body is produced for any locale and the draft retains the raw changelog body as the delivery fallback

#### Scenario: One locale's generation failure does not block the others
- **WHEN** the humanization write pass for one locale fails while another locale succeeds
- **THEN** the succeeding locale's body is stored, the failed locale simply has no body and falls back at delivery, and the failure is logged as a warning without failing the draft

### Requirement: Body resolution fallback chain

The system SHALL store the English/default humanized body separately from the non-English localized bodies of a version. Resolving the announcement body for a locale SHALL follow the chain: the localized body for that locale, then the English humanized body, then the raw changelog body. Announcement rows created before localization SHALL remain valid and resolvable without data migration.

#### Scenario: Locale body present
- **WHEN** a body is resolved for `ru` and a stored Russian body exists for the version
- **THEN** the Russian body is used

#### Scenario: Locale body absent
- **WHEN** a body is resolved for `ru` and no Russian body exists for the version
- **THEN** the English humanized body is used

#### Scenario: No humanized body at all
- **WHEN** a body is resolved for any locale and neither a localized nor an English humanized body exists
- **THEN** the raw changelog body is used

### Requirement: Per-recipient localized delivery

Broadcast SHALL deliver to each opt-in subscriber — DM user or group — the body resolved for that subscriber's config-context `language` via the fallback chain. A DM recipient's locale SHALL be that user's DM config-context language; a group recipient's locale SHALL be the group's shared config-context language, shared across all of the group's threads. Each delivered announcement SHALL contain text of exactly one language. Per-recipient idempotency and failure isolation SHALL be preserved, and localized delivery SHALL behave identically across every platform instance.

#### Scenario: Russian DM subscriber
- **WHEN** a user whose DM language is `ru` and who opted into release announcements is broadcast a version having a Russian body
- **THEN** the DM delivers the Russian body

#### Scenario: Mixed-language subscribers
- **WHEN** the same version is broadcast to an `en` DM subscriber and a `ru` DM subscriber
- **THEN** each subscriber receives the body in their own language

#### Scenario: Group locale is group-shared
- **WHEN** a group whose shared language is `ru` is broadcast a version having a Russian body
- **THEN** the announcement posted to the group is the Russian body, irrespective of which thread it lands in

#### Scenario: Fallback at delivery
- **WHEN** a `ru` subscriber is broadcast a version with no Russian body but with an English humanized body
- **THEN** the subscriber receives the English body

#### Scenario: No resolvable body records a failed delivery
- **WHEN** a recipient's resolution chain yields no body at all (no localized body, no English body, no raw body)
- **THEN** a failed delivery is recorded for that recipient rather than the recipient being skipped silently

#### Scenario: Independent of task instance
- **WHEN** a subscriber's context has no task instance assigned
- **THEN** the localized announcement is still delivered per the language resolution chain

#### Scenario: Platform parity
- **WHEN** opt-in subscribers with the same locales exist on two different platform instances
- **THEN** both instances deliver per-locale bodies by the same resolution chain

### Requirement: Localized admin review notice

The startup review notice DM to the admin SHALL carry the announcement body resolved for the admin's config-context language (localized body, then English body, then raw body), with the notice's wrapper text rendered in that same language. The review notice SHALL NOT fan out to subscribers.

#### Scenario: Russian admin
- **WHEN** the admin's config context language is `ru` and a Russian body exists
- **THEN** the review-notice DM shows the Russian body inside a Russian wrapper text

#### Scenario: Russian admin without a Russian body
- **WHEN** the admin's config context language is `ru` and no Russian body exists
- **THEN** the review-notice DM shows the English humanized body, or the raw body when no humanized body exists

### Requirement: Per-locale admin review, editing, and regeneration

The settings Release-notes admin surface SHALL expose the per-locale bodies: reading SHALL return each supported locale's body, with `null` meaning not generated; saving SHALL update exactly the addressed locale's body (an English save updates the default body) without altering other locales; regeneration SHALL support a single locale or all supported locales and replace only the regenerated locales' bodies; broadcasting SHALL deliver the stored per-locale bodies. The nothing-to-broadcast guard SHALL reject only when no English body, no localized body, and no raw body exist for the version.

#### Scenario: Read shows a not-generated locale
- **WHEN** the admin reads Release notes for a version humanized only in English
- **THEN** the response shows the English body and a `null` Russian body

#### Scenario: Saving one locale leaves others untouched
- **WHEN** the admin saves an edited Russian body
- **THEN** only the Russian body changes, and the English body delivered to English subscribers on subsequent broadcast is unchanged

#### Scenario: Regenerate a single locale
- **WHEN** the admin regenerates the Russian body
- **THEN** the Russian body is re-humanized from the stored raw changelog section and the English body is unchanged

#### Scenario: Regenerate all locales
- **WHEN** the admin triggers regeneration without naming a locale
- **THEN** every supported locale's body is regenerated

#### Scenario: Broadcast sends edited bodies
- **WHEN** the admin edits bodies of both locales and clicks Broadcast
- **THEN** the edits are persisted first and each subscriber receives the edited body for their locale

#### Scenario: Nothing-to-broadcast guard
- **WHEN** broadcast is requested for a version with no English body, no localized body, and no raw body
- **THEN** the request is rejected as having nothing to broadcast

#### Scenario: Raw-only version is broadcastable
- **WHEN** broadcast is requested for a version that has only a raw body
- **THEN** the broadcast proceeds and subscribers receive the raw body

### Requirement: Per-locale release-notes editing UI

The settings-UI Release-notes section SHALL provide one editor per supported locale behind a locale switcher. Save and regenerate SHALL act on the active locale. A locale whose body is not generated SHALL be marked as falling back to English at delivery. Broadcast SHALL persist pending edited bodies before broadcasting.

#### Scenario: Locale switcher
- **WHEN** the admin opens the Release-notes section for a version with both bodies
- **THEN** separate EN and RU editors are available, each showing its locale's stored body

#### Scenario: Fallback indication
- **WHEN** the active locale's body is `null`
- **THEN** the editor indicates that delivery for that locale falls back to English

#### Scenario: Save acts on the active locale
- **WHEN** the admin edits the text in the RU editor and saves
- **THEN** only the Russian body is saved

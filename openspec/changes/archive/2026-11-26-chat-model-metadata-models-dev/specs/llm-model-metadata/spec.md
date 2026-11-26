<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Gives papai real per-model knowledge — context window and maximum output tokens — sourced from the models.dev catalogue with the built-in prefix table as fallback, applied automatically to every bound LLM role and previewed live in the settings UI wherever a provider+model pair is selected.

## ADDED Requirements

### Requirement: Model catalogue ingestion and degradation

The system SHALL maintain a snapshot of per-model facts (context window, maximum output tokens) from the models.dev catalogue, refreshed periodically in the background, prewarmed at boot, and persisted to an on-disk cache that survives restarts. Catalogue fetches SHALL be time-bounded and best-effort: a failed, timed-out, or malformed fetch SHALL keep the previous snapshot in place (or an empty snapshot at first boot), SHALL log a warning without credential material, and SHALL NOT block startup, chat traffic, or any settings request. The time the snapshot was last fetched SHALL be observable to consumers, with a null value meaning no snapshot has ever been obtained, so clients can distinguish "catalogue unavailable" from "model not found".

#### Scenario: Catalogue reachable at boot

- **WHEN** the process starts and models.dev responds within the fetch bound
- **THEN** the snapshot holds catalogue entries and a non-null fetch time

#### Scenario: Refresh failure keeps last good snapshot

- **WHEN** a refresh attempt times out, fails, or returns malformed data
- **THEN** the previously loaded snapshot remains in use, a warning is logged, and no request blocks on the catalogue

#### Scenario: Offline start

- **WHEN** the process starts with no cached snapshot and models.dev unreachable
- **THEN** the system operates with an empty snapshot and the prefix-table fallback, degrading rather than failing

#### Scenario: Unavailable distinguished from unknown

- **WHEN** a consumer asks about a model while no snapshot has ever been obtained
- **THEN** the result reports a null snapshot fetch time, distinct from a model missing from a loaded catalogue

### Requirement: Single resolution precedence

The system SHALL resolve, for any provider+model pair, one metadata result comprising the resolved provider id, model id, context window, and maximum output tokens (each nullable), the source (`models-dev` catalogue, prefix table, or none), and how the reference was obtained (explicit override, inferred, or none). Resolution SHALL apply one fixed precedence: an explicit base-provider/base-model declaration on the provider account SHALL win; otherwise the provider's type — or, for custom gateways, the base-URL host — SHALL be used to infer the catalogue provider; otherwise the built-in model-name prefix table SHALL supply a context-window guess; otherwise the result SHALL be `none`. Every consumer — the token-budget trim trigger, the `/context` display, generation settings, and the settings preview — SHALL observe the same result for the same public inputs.

#### Scenario: Explicit override wins

- **WHEN** a provider account declares a base provider+model and the bound model name would also match the prefix table
- **THEN** the declared entry's limits and source are used and the result is marked as coming from the override

#### Scenario: Inferred from provider identity

- **WHEN** no override is declared and the provider's type (or a custom gateway's base-URL host) maps to a known catalogue provider
- **THEN** the catalogue entry for the bound model under that provider is used

#### Scenario: Prefix-table fallback

- **WHEN** the model cannot be located in the catalogue (or no snapshot exists) but its name matches the built-in prefix table
- **THEN** the prefix table's context window is used and the source reports a prefix guess rather than a catalogue hit

#### Scenario: Nothing known

- **WHEN** the model matches neither the catalogue nor the prefix table and no override is declared
- **THEN** all limits resolve to unknown and the source reports `none`

#### Scenario: Preview equals runtime

- **WHEN** the settings preview and the runtime resolve the same public provider fields and model name
- **THEN** both produce identical limits, source, and override marking

### Requirement: Known limits drive token budgeting and generation

When a bound model's context window is known, the conversation token-budget trim trigger SHALL evaluate against that value and the `/context` command SHALL display it as the ceiling. When a bound model's maximum output tokens is known, generation requests for that model SHALL carry exactly that output cap; when unknown, generation requests SHALL be sent without an output-cap setting, unchanged from current behavior.

#### Scenario: Trim trigger enabled by catalogue data

- **WHEN** a bound model absent from the prefix table is found in the catalogue with a context window
- **THEN** the token-ratio trim trigger evaluates against that context window and `/context` shows it as the ceiling

#### Scenario: Unknown model unchanged

- **WHEN** a bound model resolves to `none`
- **THEN** no trim-trigger ceiling and no `/context` ceiling appear, and generation requests carry no output-cap setting

#### Scenario: Output cap applied via override

- **WHEN** a bound model's catalogue entry, reached through the provider account's explicit declaration, declares a maximum output token count
- **THEN** generation requests for that model request exactly that cap

### Requirement: Custom gateway mapping declaration

Users SHALL be able to declare, per provider account, optional base-provider and base-model references identifying which known catalogue entry a custom or gateway model corresponds to. The fields SHALL be free-text public identifiers, never credentials; SHALL be optional and clearable, with clearing restoring pure inference; SHALL be accepted and echoed by both the admin provider configuration and the per-context BYOK provider flows; SHALL be persisted through the provider account's encrypted storage such that accounts stored before this capability decode unchanged; and SHALL appear in the public provider-account representation shown to clients without any credential material. The global provider account's environment bootstrap SHALL also accept optional base-reference variables.

#### Scenario: Declaring a mapping on a BYOK account

- **WHEN** a member saves a BYOK provider account with base provider and base model set
- **THEN** the values are stored with the account, echoed back on read, and used by every role bound to that account across the group's threads

#### Scenario: Legacy account decodes unchanged

- **WHEN** an encrypted provider account stored before this capability is loaded
- **THEN** it decodes successfully with no base references declared

#### Scenario: Clearing restores inference

- **WHEN** the base references are removed from a provider account that previously declared them
- **THEN** resolution falls back to inference and the prefix table, and no override marking appears

#### Scenario: Public representation stays credential-free

- **WHEN** a provider account with declared base references is rendered to a client
- **THEN** the base references appear alongside the other public fields and no API key or other secret material appears

#### Scenario: Environment bootstrap of the global account

- **WHEN** the optional base-reference environment variables are set for the global provider
- **THEN** the bootstrapped global account carries those references as if configured through the UI

### Requirement: Live preview at model selection

Wherever a settings surface lets a user choose or type a provider and model pair — the shared role-binding block used by the admin models section, the BYOK section, and group surfaces, and the provider forms' base-reference fields — the system SHALL show, inline and without saving, the limits that will apply: context window, maximum output tokens, and the source of those values. The preview SHALL track the currently entered values so that a superseded in-flight lookup never overwrites a newer result, and SHALL distinguish a catalogue hit (marked when an explicit declaration drove it) from a prefix-table guess, from no known limits, and from an unavailable catalogue. On a provider form, entering base references SHALL preview the resolved catalogue entry before the form is saved, so a mistyped identifier is visible immediately.

#### Scenario: Catalogue hit shown inline

- **WHEN** a user selects a provider and enters a model name the catalogue knows
- **THEN** a muted read-only line shows the provider/model identity, the context window, and the maximum output tokens

#### Scenario: Override marker

- **WHEN** the shown limits come from the provider account's explicit base declaration rather than inference
- **THEN** the preview marks them as coming from the override

#### Scenario: Prefix guess distinguished

- **WHEN** the model is not in the catalogue but matches the prefix table
- **THEN** the preview labels the context window as a prefix guess and shows no catalogue output cap

#### Scenario: No limits known

- **WHEN** the entered pair resolves to `none`
- **THEN** the preview states that no limits are known

#### Scenario: Catalogue unavailable

- **WHEN** no catalogue snapshot exists while the user edits a model field
- **THEN** the preview reports the catalogue as unavailable rather than a stale or empty result

#### Scenario: Provider form pre-save preview

- **WHEN** a user types base references into a provider form
- **THEN** the preview shows the resolved catalogue entry's context window and output cap before the form is saved

#### Scenario: Rapid edits

- **WHEN** the model input changes faster than lookups complete
- **THEN** the preview reflects only the newest input's result

### Requirement: Metadata lookup endpoint access and safety

The settings API SHALL expose a read-only model-metadata lookup that resolves the same metadata as the runtime from client-supplied public fields (provider type, base URL, base provider, base model, model name). It SHALL require an authenticated settings principal but SHALL NOT require a context scope or administrator privilege, because member-facing BYOK and group forms use it. Serving a lookup SHALL NOT trigger any outbound catalogue fetch — it SHALL read only the maintained snapshot — and SHALL report a missing snapshot distinctly from an unknown model. The endpoint SHALL accept and return only the public fields above plus the snapshot fetch time, SHALL reject unauthenticated callers, and SHALL never accept, return, or log credential material.

#### Scenario: Unauthenticated caller rejected

- **WHEN** a request without a valid settings session reaches the lookup
- **THEN** it is rejected by the standard settings authentication gate and no metadata is returned

#### Scenario: Non-admin member allowed

- **WHEN** an authenticated non-admin settings principal requests a lookup
- **THEN** the lookup succeeds with no context scope attached to the request

#### Scenario: No outbound fetch while serving

- **WHEN** a lookup arrives while the catalogue snapshot is empty or expired
- **THEN** the endpoint answers from the snapshot alone — reporting unavailable or a miss as applicable — without fetching models.dev

#### Scenario: Unavailable vs unknown distinguished

- **WHEN** no catalogue snapshot exists and a lookup arrives
- **THEN** the response reports the catalogue as unavailable (null fetch time) even if the requested model would exist in the catalogue

#### Scenario: Credential-free contract

- **WHEN** any lookup request is made, including with malformed or hostile input
- **THEN** only the public fields are read, only public metadata plus the fetch time is returned, and no credential material is accepted, returned, or logged

### Requirement: Cross-instance and context neutrality

Model metadata resolution SHALL depend only on the provider account and model name, never on which platform instance or conversation context uses them: two platform instances backed by the same provider account SHALL get identical limits, and a context with its own BYOK provider account SHALL get that account's declared references. The capability SHALL introduce no new chat tool, so guest-mode toolsets, `tool_prefs` resolution, and confirmation flows are unaffected.

#### Scenario: Shared provider account across instances

- **WHEN** conversations on two platform instances are backed by the same provider account and model
- **THEN** both apply the same context window and output cap

#### Scenario: BYOK context uses its own mapping

- **WHEN** a group context's BYOK provider account declares base references different from the global account's
- **THEN** that context's roles use the BYOK account's entry

#### Scenario: Guest mode unaffected

- **WHEN** a guest-mode user interacts in a group whose conversation runs on a catalogue-known model
- **THEN** the applied limits are identical to a member's and no guest-visible toolset or permission changes

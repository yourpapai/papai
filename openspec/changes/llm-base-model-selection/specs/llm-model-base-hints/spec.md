<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets the owner attach models.dev catalogue-alias base hints to individual models of a
provider, so models whose ids do not match the models.dev catalogue resolve real
metadata — context window, max output tokens, and derived reasoning/effort data —
instead of falling back to inference tables or nothing.

## ADDED Requirements

### Requirement: Per-model base hints attach catalogue aliases to individual models

A provider configuration SHALL accept per-model base hints: a mapping from an exact
model id served by that provider to a pair of models.dev catalogue aliases (a base
provider alias and a base model alias). Every entry SHALL carry both aliases; an entry
missing either SHALL be invalid. Models without a hint SHALL resolve metadata exactly
as they do without this capability.

#### Scenario: Unhinted sibling models are unaffected

- **WHEN** a provider carries a hint for one of its model ids
- **THEN** metadata resolution for the provider's other model ids ignores that hint
- **AND** those models keep the provider-level base fields, catalogue inference, and
  prefix-table chain they had before

#### Scenario: A hint entry missing an alias is rejected

- **WHEN** a hint names a model id but omits the base provider alias or the base model
  alias
- **THEN** the update carrying it is rejected as malformed
- **AND** the provider's previously stored hints are left unchanged

### Requirement: Hint resolution follows a fixed precedence

When resolving catalogue metadata for a model served under a provider account, the
system SHALL consult, in order: the per-model hint whose key equals the model id being
resolved; then the provider-level base provider and base model fields; then the
existing inference and prefix-table chain, unchanged. Hint keys SHALL match the bound
model id by exact string comparison, with no normalization, partial matching, or
wildcards.

#### Scenario: A per-model hint overrides the provider-level pair

- **WHEN** a provider has provider-level base fields set and a hint whose key equals
  the model id being resolved
- **THEN** the metadata comes from the hint's catalogue pair
- **AND** the provider-level pair is ignored for that model

#### Scenario: An unhinted model falls through to the provider-level pair

- **WHEN** the model id being resolved has no hint but the provider has provider-level
  base fields
- **THEN** the metadata comes from the provider-level pair, as before this capability

#### Scenario: A similar model id does not match a hint

- **WHEN** the hint key is `hf:zai-org/GLM-5.3-Flash` and the model being resolved is
  a different id that extends that string, such as `hf:zai-org/GLM-5.3-Flash-turbo`
- **THEN** the hint does not apply to that model

#### Scenario: A hint names a pair absent from the catalogue

- **WHEN** a hint's base provider alias or base model alias is not present in the
  models.dev catalogue
- **THEN** the model resolves exactly as an unresolvable provider-level pair does
  today: catalogue inference is skipped and the prefix-table/none chain decides
- **AND** no additional fallback behavior is introduced

### Requirement: Hints change metadata only

Adding, editing, or removing a per-model hint SHALL NOT change which model id is
invoked, which credentials are used, or any role binding. It SHALL change only the
catalogue metadata returned for that model id: context window, max output tokens, and
data derived from it such as reasoning/effort levels.

#### Scenario: A bound role keeps calling the same model

- **WHEN** a hint is added for the model id bound to a role
- **THEN** subsequent turns still invoke the same model id with the same provider
  credentials
- **AND** only the resolved metadata for that model differs

### Requirement: Hints persist with the provider configuration

Per-model hints SHALL be stored as part of the provider configuration and SHALL
survive restarts and provider reloads. An upgrade to this capability SHALL NOT backfill
or rewrite stored providers that have no hints; such providers SHALL continue to load
and behave unchanged.

#### Scenario: Saved hints survive a restart

- **WHEN** a provider is saved with hints and the process restarts or the provider
  list is reloaded
- **THEN** the same hints are still attached to the same model ids

#### Scenario: A provider stored before hints keeps working

- **WHEN** a provider configuration stored before this capability is loaded after the
  upgrade
- **THEN** it loads as having no hints and its metadata resolution is unchanged

### Requirement: Admin provider API exposes hints

The admin provider endpoints SHALL accept per-model hints on provider update, persist
them, and return them on provider read (an empty set when none are stored). An update
carrying malformed hints SHALL be rejected with a validation error (HTTP 422) and
SHALL NOT modify the stored provider. Hints SHALL hold catalogue aliases only and
SHALL NOT be treated as, or entangled with, provider credentials.

#### Scenario: Valid hints persist and read back

- **WHEN** an admin updates a provider with well-formed hints and then reads the
  provider
- **THEN** the read returns the same hints keyed by the same model ids

#### Scenario: Malformed hints are rejected without side effects

- **WHEN** an admin update carries hints where an entry lacks an alias, or a hints
  value that is not a mapping of string model ids to alias pairs
- **THEN** the endpoint responds with HTTP 422
- **AND** the stored provider configuration is unchanged

### Requirement: BYOK providers carry hints inside their encrypted blob

The BYOK provider storage SHALL treat per-model hints as an optional part of each
provider entry. Hints SHALL live only inside the encrypted BYOK blob — encrypted at
rest together with the rest of that configuration — and SHALL NOT be persisted or
logged in plaintext outside it. Blobs written before hints existed SHALL decode
unchanged and yield no hints. A hints value that is missing or malformed in a blob
SHALL normalize to no hints for that provider rather than failing the decode or
affecting the other providers in the blob. The BYOK provider upsert SHALL accept an
optional hints mapping so a client can round-trip a provider with its hints; when
omitted, the provider SHALL be stored with no hints.

#### Scenario: Hints round-trip through a BYOK upsert

- **WHEN** a BYOK provider is upserted with hints and its configuration is later read
  back
- **THEN** the same hints keyed by the same model ids are returned

#### Scenario: A blob written before hints decodes unchanged

- **WHEN** an encrypted blob created before this capability is decoded after the
  upgrade
- **THEN** decoding succeeds, every provider yields no hints, and metadata resolution
  for those providers is unchanged

#### Scenario: A malformed hints value does not break the blob

- **WHEN** a blob contains a malformed hints value on one provider
- **THEN** that provider decodes with no hints and the remaining providers in the blob
  decode with their stored hints intact

### Requirement: Settings UI edits per-model hints on an existing provider

The admin provider edit form SHALL let the owner add, amend, and remove per-model
hints for that provider. The model id of a new hint SHALL be chosen from the
provider's enumerated models, and a model that already has a hint SHALL NOT be offered
again. Each hint's base provider and base model aliases SHALL be editable as free-form
catalogue-alias inputs, and the form SHALL preview the catalogue metadata the entered
pair resolves to before saving, with an unresolved indication when the pair is absent
from the catalogue. Saving the form SHALL persist the hints through the provider
update. Creating a new provider SHALL NOT require any hints.

#### Scenario: The owner adds a hint and saves

- **WHEN** the owner picks an enumerated model, enters both aliases, and saves the
  provider form
- **THEN** the provider update carries the new hint and it is persisted

#### Scenario: A hinted model is not offered twice

- **WHEN** the owner opens the add-hint control on a provider where a model already
  has a hint
- **THEN** that model is not offered as a choice for another hint

#### Scenario: The preview distinguishes resolved from unresolved pairs

- **WHEN** the owner enters a hint pair
- **THEN** the form shows the catalogue metadata that pair resolves to, live and
  before saving
- **AND** a pair absent from the catalogue is shown as unresolved rather than
  silently resolving to something else

#### Scenario: The owner removes a hint and saves

- **WHEN** the owner removes a hint row and saves the provider form
- **THEN** the stored provider no longer carries that hint

### Requirement: Hint scope follows the provider configuration's scope

Hints on a centrally administered provider SHALL apply wherever that provider is used,
across all platform instances and conversation contexts. Hints on a BYOK provider
SHALL be scoped to that BYOK configuration's config context — group-shared durable
configuration — SHALL apply to every conversation in that context, and SHALL NOT
affect the providers of any other config context.

#### Scenario: A central provider's hint applies everywhere it is used

- **WHEN** a centrally administered provider carries a hint and roles bound to models
  of that provider run in different platform instances
- **THEN** metadata resolution honors the hint in every such instance and context

#### Scenario: BYOK hints do not cross config contexts

- **WHEN** a BYOK configuration in one config context carries hints
- **THEN** providers of another config context resolve with no knowledge of those
  hints

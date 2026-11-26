# Spec Delta

## Purpose

Create the Kaneo workspace account and its stored service credential for a chat context — group-shared for groups, per-user for DMs — so that context's task provider resolves and Kaneo group-member registration becomes reachable.

## ADDED Requirements

### Requirement: Provisioning mints an account email valid for every actor identifier

The Kaneo provision hook SHALL derive the synthetic Better Auth account email so that it validates as an RFC 5321 address for every identifier the core can supply, including scoped config context ids containing `:` (`pi:<b64>:ctx:<b64>`), `@`-prefixed platform ids (`@user:server`), numeric ids, unicode names, and an empty string. A name derived from a sanitized local part SHALL remain unique per account.

#### Scenario: Group context with no username

- **WHEN** a group-scoped provisioning request arrives for config context id `pi:<b64>:ctx:<b64>` with a null username
- **THEN** the sign-up request carries an address that passes the provider's email validation and provisioning finishes with outcome `provisioned`

#### Scenario: Matrix-style and Kontur Talk identifiers

- **WHEN** an identifier such as `@john:chat.company.com` reaches provisioning with no username
- **THEN** the account email is still valid and provisioning is attempted normally

#### Scenario: Telegram numeric id and unicode display names

- **WHEN** a purely numeric id or a unicode display name reaches provisioning
- **THEN** the account email is valid; unicode characters never appear raw in the email local part

#### Scenario: Empty identifier

- **WHEN** provisioning receives an empty actor identifier
- **THEN** the local part falls back to a non-empty, valid value instead of producing `-<suffix>@…`

#### Scenario: Username present

- **WHEN** a username is available
- **THEN** the derived email is still valid and unique, preserving the previously working case

### Requirement: Successful provisioning persists the context-scoped workspace binding

On a `provisioned` outcome the system SHALL store the provider credential and workspace id as context-scoped config for the provisioning context id — shared by every thread of a group, or keyed to the user's personal config context for a DM — so later turns in that context resolve the task provider instead of the providerless fallback.

#### Scenario: Group provisioning unlocks the group's provider

- **WHEN** a group's provisioning finishes with outcome `provisioned`
- **THEN** the credential and workspace id exist under that group's config context id, and a later message in any thread of that group resolves the Kaneo provider

#### Scenario: DM provisioning stays per-user

- **WHEN** a DM context provisions successfully
- **THEN** the binding is stored under that user's personal config context and is not visible to any group context

### Requirement: Provisioning stores credentials encrypted and never exposes them

The provider credential SHALL be persisted encrypted at rest and MUST NOT be written to logs, chat replies, or the provisioning response beyond the one-time generated password that the provisioning operator already receives. The generated password SHALL NOT be persisted in plaintext.

#### Scenario: Credential handling on success

- **WHEN** provisioning succeeds
- **THEN** the stored credential is decryptable only through the instance encryption key, logs contain no credential or password value, and the response carries the generated password once

### Requirement: Failed provisioning is explicit and leaves no partial state

When the provider rejects any provisioning step (validation error, auth failure, rate limit, network failure) the system SHALL return a failed outcome carrying the provider's error message, SHALL NOT write a credential or workspace binding, and SHALL leave the context unconfigured so a later attempt can succeed. A provider-declared registration-disabled response SHALL remain a distinct `registration_disabled` outcome.

#### Scenario: Provider rejects the account identity

- **WHEN** the provider answers the sign-up call with HTTP 400 for an invalid email
- **THEN** the outcome is `failed` with that error, no credential or workspace is stored for the context, and a corrected retry can provision

#### Scenario: Rate-limited sign-up

- **WHEN** the provider answers sign-up with HTTP 429
- **THEN** the outcome is `failed`, nothing is written, and the next attempt after the provider's window succeeds

#### Scenario: Registration disabled

- **WHEN** the provider reports that registration is disabled
- **THEN** the outcome is `registration_disabled` (not a generic failure) and nothing is written

### Requirement: Provisioning requires an active connected task instance

Provisioning SHALL be rejected without any provider call when the target context has no active task instance, or when the bound task instance's provider type exposes no provision hook.

#### Scenario: Unconfigured context

- **WHEN** a provisioning request targets a context with a null or inactive task instance
- **THEN** the request is rejected as a client error and no outbound provider request is made

#### Scenario: Provider without a provision hook

- **WHEN** the bound task instance's provider type has no provision hook
- **THEN** the request reports the provider type as unsupported and nothing is stored

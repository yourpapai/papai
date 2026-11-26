# Spec Delta

## Purpose

Registers a chat group member as a real Kaneo workspace user through the bot's internal deployment path, so member provisioning no longer depends on public sign-up while the member's one-time credential stays encrypted at rest.

## ADDED Requirements

### Requirement: Member auth traffic uses the internal Kaneo URL

When the assigned Kaneo task instance configures an internal URL, the system SHALL send member sign-up, sign-in, invitation, and invitation-acceptance requests to that internal URL while using the public Kaneo URL as the trusted `Origin` and link base. When no internal URL is configured it SHALL use the public URL for both. Task and API operations SHALL continue to use the public URL.

#### Scenario: Edge blocks public sign-up

- **WHEN** the public edge rejects `/api/auth/sign-up/*` with 403 and the task instance has an internal URL
- **THEN** member sign-up is sent to the internal URL and provisioning completes without unblocking public registration

#### Scenario: No internal URL configured

- **WHEN** the task instance has no internal URL
- **THEN** member auth requests use the public URL exactly as before this change

#### Scenario: Trusted origin stays public

- **WHEN** invitation or acceptance requests are sent to the internal URL
- **THEN** the `Origin` header and the workspace URL shown to the member remain the public URL

#### Scenario: Task links stay public

- **WHEN** the bot builds a task or project link after this change
- **THEN** the link uses the public URL, never the internal one

### Requirement: Successful provisioning persists an active member with encrypted credentials

On a successful sign-up-or-reuse plus invite-and-accept sequence, the system SHALL upsert a row keyed by group config context id, chat user id, and provider name with status `active`, the provider user id, the login, and the generated password encrypted with the instance encryption key. It SHALL create the `provisioned` identity mapping and SHALL NOT store or log the plaintext password.

#### Scenario: New member provisioned

- **WHEN** sign-up, invite, and acceptance all succeed
- **THEN** the member row is `active` with a login and non-null encrypted password

#### Scenario: Plaintext never persisted

- **WHEN** provisioning succeeds
- **THEN** the row and logs contain no plaintext password

#### Scenario: Identity link is lowest priority

- **WHEN** the chat user already has an `auto` or `manual_nl` identity mapping
- **THEN** provisioning keeps that mapping and does not overwrite it

### Requirement: Failed provisioning leaves no partial credential and is retryable

On any member provisioning failure the system SHALL record the row as `failed` with empty provider id and login and a null password, SHALL NOT throw into the triggering subscriber, backfill, or turn, and SHALL allow a later trigger to retry the same chat user.

#### Scenario: Sign-up rejected

- **WHEN** the provider rejects sign-up with an HTTP error
- **THEN** the row is `failed`, no password is stored, and the group turn is unaffected

#### Scenario: Invite or acceptance fails

- **WHEN** sign-up succeeds but invitation or acceptance fails
- **THEN** no credential is recorded and a later retry can provision again

#### Scenario: Retry succeeds

- **WHEN** a later trigger retries a `failed` row and every step succeeds
- **THEN** the row is overwritten to `active` with fresh credentials

### Requirement: Provisioning triggers and eligibility

The system SHALL provision non-guest group members on `group_member:added`, on the startup backfill, and on the first non-guest group turn, and SHALL skip guests, placeholder user ids, and contexts whose resolved provider does not advertise member provisioning.

#### Scenario: Member added via settings

- **WHEN** a group admin adds a user to the group
- **THEN** the added event provisions that user into the group's existing workspace

#### Scenario: Member speaks first

- **WHEN** an eligible member sends a group message and the group provider resolves
- **THEN** the turn backstop provisions that member without blocking the turn

#### Scenario: Guest is excluded

- **WHEN** a guest sends a group message
- **THEN** no member row is created and no provider request is made

#### Scenario: Group has no provider

- **WHEN** the group has no resolved Kaneo provider advertising member provisioning
- **THEN** the attempt is skipped and no row is written

### Requirement: Existing account reuse across groups

When any group already holds an encrypted password for the same chat user, the system SHALL sign in with that stored credential and invite the existing account rather than creating a second account. When the stored password is absent or cannot be decrypted, it SHALL fall back to a fresh sign-up.

#### Scenario: Same person in a second group

- **WHEN** a member with a stored credential joins another group
- **THEN** provisioning signs in to the existing account and invites it, keeping the existing login

#### Scenario: Nothing to reuse

- **WHEN** no row for the chat user has an encrypted password
- **THEN** provisioning creates a new account with a new random-suffix login

#### Scenario: Stored password undecryptable

- **WHEN** the stored ciphertext cannot be decrypted with the instance key
- **THEN** provisioning falls back to a fresh sign-up instead of failing the attempt

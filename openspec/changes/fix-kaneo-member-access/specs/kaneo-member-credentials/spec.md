# Spec Delta

## Purpose

Lets a group member retrieve only their own Kaneo workspace login and reveal their generated password once from the settings UI, without requiring group-manager scope or exposing another member's credentials.

## ADDED Requirements

### Requirement: Member lists own workspace memberships

An authenticated settings session SHALL list only the caller's own member rows — group label, login, status, and workspace URL — for groups on the caller's platform instance that are currently authorized. The list SHALL NOT require a group-manager scope and SHALL NOT include any password. Rows of other users, rows from other platform instances, and rows of deauthorized groups SHALL be excluded.

#### Scenario: Member belongs to two provisioned groups

- **WHEN** the caller has active rows in two authorized groups
- **THEN** both memberships are returned with their login, status, and workspace URL

#### Scenario: Group was deauthorized

- **WHEN** the caller still has a row for a group that is no longer authorized
- **THEN** that row is not listed

#### Scenario: Another member's row is requested

- **WHEN** the caller's platform user id differs from the row's chat user id
- **THEN** the row is never returned

#### Scenario: Same numeric id on another platform instance

- **WHEN** another platform instance has a row with the same chat user id
- **THEN** it is excluded from the caller's list

#### Scenario: Group task instance is unconfigured

- **WHEN** the caller's row exists but the group's task instance is null
- **THEN** the membership is still listed with a null workspace URL

#### Scenario: No memberships

- **WHEN** the caller has no member row
- **THEN** the list is empty and no error is returned

### Requirement: Member reveals own password exactly once

The reveal operation SHALL authorize by row ownership — group config context id, caller's platform user id, caller's platform instance, and a currently authorized group — require the settings CSRF token, decrypt the stored ciphertext, return the plaintext exactly once, and clear the ciphertext immediately. The list and every other response SHALL never contain the password. A row owned by another member SHALL be denied without revealing whether it exists.

#### Scenario: Owner reveals the password

- **WHEN** the caller owns the row and sends a valid reveal request with CSRF
- **THEN** the plaintext password is returned with a store-securely warning and the stored ciphertext is cleared

#### Scenario: Second reveal is refused

- **WHEN** the caller reveals again after the ciphertext was cleared
- **THEN** the request is refused as a conflict and no password is returned

#### Scenario: Missing CSRF

- **WHEN** an authenticated reveal request omits or invalidates the CSRF token
- **THEN** the request is rejected and the row is unchanged

#### Scenario: Row belongs to another member

- **WHEN** the requested context has a row for a different chat user
- **THEN** the request is denied without identifying that row

#### Scenario: Decryption fails

- **WHEN** the stored ciphertext cannot be decrypted with the instance key
- **THEN** the request fails with a generic error and the row is left unchanged

### Requirement: Group-manager credential route keeps its behavior

The existing group-scoped credential route SHALL continue to authorize group managers and return the caller's own row for that group. The member-scoped route SHALL NOT broaden group scope: a caller without group-manager status gains access only to memberships they own through the member-scoped route.

#### Scenario: Group admin uses the group context

- **WHEN** a group admin opens the group context and requests their credentials
- **THEN** the existing group route returns their own row as before

#### Scenario: Non-admin member uses the self route

- **WHEN** a non-admin member requests their own memberships
- **THEN** the group-manager check is not applied and only their own rows are returned

### Requirement: Personal settings surface exposes self access

The settings UI SHALL render a "My Kaneo access" surface in the personal context for an authorized user, listing that user's memberships and offering the reveal action per membership. The group-context surface SHALL remain available for group admins.

#### Scenario: Authorized member opens personal settings

- **WHEN** an authorized member opens the personal context
- **THEN** their memberships are listed with login, status, and workspace URL, and each row offers reveal

#### Scenario: Not provisioned

- **WHEN** the caller has no memberships
- **THEN** an empty state explains that no Kaneo access exists and offers a re-check

#### Scenario: Reveal-once warning

- **WHEN** the password is revealed
- **THEN** the UI states it will not be shown again and removes the reveal action

### Requirement: Credentials stay encrypted and never logged

The stored password SHALL remain encrypted at rest under the instance encryption key. The plaintext SHALL appear only in the successful reveal response, and no log, list response, error message, or chat reply SHALL contain it.

#### Scenario: List contains no secret

- **WHEN** memberships are listed
- **THEN** the response contains login and status but no password or ciphertext

#### Scenario: Logs contain no secret

- **WHEN** provisioning, listing, or revealing runs
- **THEN** no log entry contains the password or the encryption key

#### Scenario: Guest access

- **WHEN** an unauthenticated or guest principal requests the member-scoped surface
- **THEN** the request is rejected before any row is read

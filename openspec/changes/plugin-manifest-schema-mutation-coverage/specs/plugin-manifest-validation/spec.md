<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the plugin manifest's parse contract as a plugin author observes it:
which manifests are rejected, the identity of each rejection (the message shown
and the field path it is attached to), and what value an omitted optional field
parses to.

## ADDED Requirements

### Requirement: A rejection names its cause and its field

Every manifest rejection SHALL carry a message stating what is wrong and a path
naming the field the author must change. An empty message, or a rejection
attached to no field, SHALL NOT satisfy this requirement — the author cannot
act on either.

#### Scenario: Rejection is attached to a field

- **WHEN** any manifest is rejected
- **THEN** the parse error carries a non-empty message and a non-empty path

### Requirement: Contribution permissions are enforced by name

Declaring a contribution SHALL require its matching permission, and the
rejection SHALL name the permission at the `permissions` path.

#### Scenario: Commands without the permission

- **WHEN** a manifest declares `contributes.commands` and omits the `commands`
  permission
- **THEN** it is rejected with "Declaring contributes.commands requires the
  'commands' permission" at path `permissions`

#### Scenario: Jobs without the permission

- **WHEN** a manifest declares `contributes.jobs` and omits the `scheduler`
  permission
- **THEN** it is rejected with "Declaring contributes.jobs requires the
  'scheduler' permission" at path `permissions`

#### Scenario: Task provider types without the permission

- **WHEN** a manifest declares `contributes.taskProviderTypes` and omits the
  `provider.task` permission
- **THEN** it is rejected with "Declaring contributes.taskProviderTypes
  requires the 'provider.task' permission" at path `permissions`

#### Scenario: Attachment transformers without the permission

- **WHEN** a manifest declares `contributes.attachmentTransformers` and omits
  the `attachments.read` permission
- **THEN** it is rejected with "Declaring contributes.attachmentTransformers
  requires the 'attachments.read' permission" at path
  `contributes.attachmentTransformers`

#### Scenario: Provider-only fields without the permission

- **WHEN** a manifest sets a provider-only field and omits the `provider.task`
  permission
- **THEN** it is rejected with "Provider-only manifest fields require the
  'provider.task' permission" at path `permissions`

#### Scenario: Contribution declared with its permission

- **WHEN** a manifest declares a contribution together with its matching
  permission
- **THEN** it parses successfully

### Requirement: A config validator requires a provider to validate

`providerConfigValidator` SHALL be accepted only alongside at least one
`contributes.taskProviderTypes` entry, and the rejection SHALL attach to
`providerConfigValidator`.

#### Scenario: Validator without a provider type

- **WHEN** a manifest sets `providerConfigValidator` and declares no
  `contributes.taskProviderTypes`
- **THEN** it is rejected with "providerConfigValidator requires
  contributes.taskProviderTypes" at path `providerConfigValidator`

#### Scenario: Validator with a provider type

- **WHEN** the same manifest also declares a `contributes.taskProviderTypes`
  entry
- **THEN** it parses successfully

#### Scenario: No validator declared

- **WHEN** a manifest omits `providerConfigValidator` and declares no provider
  types
- **THEN** the refine does not reject it

### Requirement: Context config keys must have a context-scoped requirement

Every `contributes.configKeys` entry SHALL match a context-scoped
`configRequirements` entry, and the rejection SHALL attach to the contributed
key list.

#### Scenario: Unmatched context config key

- **WHEN** a manifest contributes a config key with no context-scoped
  `configRequirements` entry of the same key
- **THEN** it is rejected with "Every contributes.configKeys entry must match a
  context-scoped configRequirements entry" at path `contributes.configKeys`

### Requirement: An entrypoint is required unless the plugin is MCP-only

A manifest SHALL declare `main` unless it is an explicit MCP-only plugin, and
the rejection SHALL attach to `main`.

#### Scenario: Missing entrypoint

- **WHEN** a manifest omits `main` and is not MCP-only
- **THEN** it is rejected with "main is required unless the manifest is an
  explicit MCP-only plugin" at path `main`

#### Scenario: MCP-only plugin

- **WHEN** a manifest declares `mcp`, contributes nothing at runtime, carries
  no provider metadata, and omits `main`
- **THEN** it parses successfully

### Requirement: Config-derived host allowlists must reference declared config

A manifest SHALL declare host-allowlist config keys only against config the
manifest itself declares, and each rejection SHALL attach to the field that
carries the offending key.

#### Scenario: Unknown plugin config key

- **WHEN** `providerAllowedHostsFromConfig` names a key with no matching
  `configRequirements` entry in either the admin or the context scope
- **THEN** it is rejected with "providerAllowedHostsFromConfig keys must
  reference at least one configRequirements entry (admin or context scope)" at
  path `providerAllowedHostsFromConfig`

#### Scenario: Unknown instance config key

- **WHEN** `providerAllowedInstanceHostsFromConfig` names a key with no
  matching `providerConfigSchema` entry
- **THEN** it is rejected with "providerAllowedInstanceHostsFromConfig keys
  must reference an instance-scoped providerConfigSchema entry" at path
  `providerAllowedInstanceHostsFromConfig`

#### Scenario: Instance host key resolves to a declared field

- **WHEN** `providerAllowedInstanceHostsFromConfig` names a key that a
  `providerConfigSchema` entry declares
- **THEN** the manifest parses successfully

#### Scenario: A key declared only in the wrong schema

- **WHEN** a key appears in `configRequirements` but not in
  `providerConfigSchema` and is named by
  `providerAllowedInstanceHostsFromConfig`
- **THEN** the manifest is rejected — the two allowlists SHALL NOT satisfy each
  other's key requirement, because instance-config hosts are operator-trusted
  and bypass the https and public-IP checks that plugin-config hosts undergo

### Requirement: A version must be a complete semver string

`version` SHALL accept a three-part version with optional prerelease and build
identifiers and SHALL reject anything less.

#### Scenario: Plain version

- **WHEN** `version` is `1.2.3`
- **THEN** the manifest parses successfully

#### Scenario: Prerelease and build identifiers

- **WHEN** `version` is `1.2.3-beta.1` or `1.2.3+build.5`
- **THEN** the manifest parses successfully

#### Scenario: Incomplete version

- **WHEN** `version` is `1.2`, `1`, or `v1.2.3`
- **THEN** it is rejected with "version must be semver
  (major.minor.patch)"

### Requirement: A config validator name must be an identifier

`providerConfigValidator` SHALL be a valid identifier, and the rejection SHALL
name that constraint.

#### Scenario: Non-identifier validator name

- **WHEN** `providerConfigValidator` starts with a digit or contains a hyphen
- **THEN** it is rejected with "Provider config validator must be a valid
  identifier"

### Requirement: Omitted optional fields parse to their declared defaults

A parsed manifest SHALL expose every optional field with a declared default as
that default rather than as `undefined`, so consumers never branch on absence.

#### Scenario: Storage scope defaults to context

- **WHEN** a manifest omits `storageScope`
- **THEN** the parsed manifest reports `context`, keying the plugin's KV store
  by the thread-scoped storage context id

#### Scenario: Storage scope set to group

- **WHEN** a manifest sets `storageScope` to `group`
- **THEN** the parsed manifest reports `group`, keying the KV store by the
  group-shared config context id

#### Scenario: Boolean flags default to false

- **WHEN** a manifest omits `defaultEnabled`, `mcpServer`, or a config
  requirement's `sensitive` flag
- **THEN** each parses to `false`

#### Scenario: List fields default to empty

- **WHEN** a manifest omits `permissions`, `configRequirements`,
  `requiredTaskCapabilities`, `requiredChatCapabilities`,
  `providerCapabilities`, `providerAllowedHostsFromConfig`, or
  `providerAllowedInstanceHostsFromConfig`
- **THEN** each parses to an empty array, not `undefined`

#### Scenario: Contributions default to empty lists

- **WHEN** a manifest omits `contributes`
- **THEN** every contribution list on the parsed manifest is an empty array

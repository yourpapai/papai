<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines how plugins declare operator-gated tools and how core consumes
those declarations through a registry port, so orchestration code never
hardcodes plugin-specific tool names.

## ADDED Requirements

### Requirement: Tool-gate registry port

The system SHALL provide a `src/ports/tool-gate.ts` registry where gated
tools are recorded by plugin and gate kind, and the port SHALL remain
feature-agnostic (no plugin ids, no feature references).

#### Scenario: Registration and lookup

- **WHEN** a plugin's contributions are built with gated tools
- **THEN** the registry reports exactly those tools for the gate kind

#### Scenario: Port purity

- **WHEN** `src/ports/**` is scanned for feature-specific identifiers
- **THEN** none are found (guard test enforces)

### Requirement: Plugin gate declaration

Plugin tools SHALL accept an optional `gate: 'operator'` declaration, and
`buildPluginToolSet` SHALL register every gated contribution with the
registry.

#### Scenario: acp session-action tools

- **WHEN** the acp plugin's tool set is built
- **THEN** `start_session`, `finish_session`, `cancel_session`,
  `answer_permission`, and `continue_session` are registered as
  operator-gated

### Requirement: Registry-driven who-may-use filter

The who-may-use filter SHALL derive its gated set from the registry and
SHALL NOT contain hardcoded plugin tool names; gating behavior for
operators and non-operators SHALL be unchanged from the hardcoded-set
implementation.

#### Scenario: Operator allowlist

- **WHEN** a member on the operator allowlist triggers a turn
- **THEN** gated session-action tools remain available

#### Scenario: Non-operator and guests

- **WHEN** a non-operator member or a guest-mode user triggers a turn
- **THEN** gated tools are absent from the offered set

#### Scenario: No plugin names in core

- **WHEN** `llm-orchestrator-tools.ts` is searched for
  `ACP_SESSION_ACTION_TOOLS` or `plugin_acp__`
- **THEN** there are no matches

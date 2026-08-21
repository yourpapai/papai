<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Keeps the local usage source table `tool_call_events` well-formed so every
downstream consumer — analytics backfill classification, usage stats, failure
reports — reads integer, non-negative durations it can trust.

## ADDED Requirements

### Requirement: Tool-call durations are recorded as clamped integers

The system SHALL record `duration_ms` in `tool_call_events` as a
non-negative integer in every write path, applying the same normalization to
usage-lane tool-finish events that the analytics lane applies: negative and
fractional raw durations SHALL be clamped to zero and rounded to the nearest
integer respectively.

#### Scenario: Fractional performance-now duration

- **WHEN** a tool call finishes with a fractional duration (e.g. `465.23`)
- **THEN** the recorded `duration_ms` is the rounded integer (`465`)

#### Scenario: Negative raw duration

- **WHEN** a tool call finishes with a negative raw duration from clock skew
- **THEN** the recorded `duration_ms` is `0`

### Requirement: Existing fractional durations are normalized once

A migration SHALL rewrite existing `duration_ms` values in
`tool_call_events` that are not integers or are negative to rounded
non-negative integers, idempotently, without touching any other column or
table. Already-rejected analytics backfill provenance is not restated.

#### Scenario: Migration over mixed values

- **WHEN** the migration runs over rows containing `465.23`, `-3`, and `321`
- **THEN** the rows become `465`, `0`, and `321` and a second run changes
  nothing

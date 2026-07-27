<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 2: Debug/settings HTTP story coverage design

## Goal

Increase Tier 0 coverage for `src/debug` by approximately four to five percentage points through hermetic, end-to-end HTTP stories. The phase exercises the real debug/settings routing surface through the existing `web.route` dependency-injection seam. It is coverage work, not a redesign of the debug server or the story harness.

## Scope

The implementation changes only story tests, except for a production defect discovered while testing. It does not add route seams, alter production behavior, modify the frozen story harness, or weaken coverage gates.

The coverage target includes the debug server, its settings and admin subrouters, public capability routes, and the otherwise-unloaded `src/debug/schemas.ts` module.

## Architecture

Every new HTTP story uses `ScenarioWorld`'s existing `web.route` override. The override invokes the real `routeRequest` with a deterministic clock, real routing composition, and scenario-provided debug options. Stories use the existing request helpers:

- `when.request` for anonymous and public requests;
- `when.dashboardRequest` for dashboard-session requests;
- `when.settingsRequest` for settings-session requests, including the real cookie and CSRF paths.

Tests are grouped by externally visible trust plane and workflow rather than one test per source module. The scenario families are:

1. Dashboard/debug routes: dashboard-session reads, debug-gate behavior, live/operator route authorization, and route-specific valid/invalid inputs.
2. Settings routes: auth exchange/bootstrap/logout, CSRF and scope enforcement, and ordinary user/group configuration workflows.
3. Settings admin routes: role boundaries plus representative platform/task instance and configuration workflows.
4. Public routes: notify, claim/auth, transcript viewer, and plugin capability routes, including their independent authentication contracts.
5. Schema contract: a compact direct-import story for `src/debug/schemas.ts`, since no production route imports it.

The direct schema contract is intentionally narrow: representative valid parsing, invalid input rejection, and safe-parse failure behavior. It is the sole exception to route-driven coverage and must not become a duplicate unit suite.

## Scenario behavior and failure contracts

Each scenario seeds the smallest necessary actor, context, identity, session, or configuration state; sends a real runtime request; and verifies a visible outcome: response status and shape, persisted configuration, or proactive delivery.

Rejected operations must prove that they do not apply side effects. The story families should cover meaningful boundary outcomes:

- `401` for missing or invalid credentials;
- `403` for a valid identity without required scope, CSRF token, or admin role;
- `404` for unknown paths and debug-gated surfaces;
- `405` for invalid methods;
- `400` or `422` for malformed inputs or domain validation failures.

Scenarios should cover adjacent routing branches when doing so reflects one coherent user workflow. They must not reproduce every implementation-level edge case already held by unit tests.

## Test organization

Extend the existing HTTP and settings story files where they already own the user journey. Add a dedicated story file only when it represents a distinct trust plane or would otherwise make an existing file incoherent. Scenario names remain stable, behavior-oriented, and compatible with the frozen story manifest.

The existing fake transports, fixtures, sessions, deterministic clock, and assertions are reused unchanged. No network, Docker configuration, client build setup, or non-hermetic dependency is introduced.

## Verification and acceptance criteria

Verification runs the affected story files, the complete Tier 0 story suite, and the coverage gate. The phase is successful when:

- all stories remain hermetic and pass without retry;
- the frozen story harness and its DI signature remain unchanged;
- `src/debug` receives approximately four to five percentage points of additional coverage, including loading `schemas.ts`;
- every added scenario asserts an observable product contract; and
- no production code changes are required unless testing identifies a genuine defect, which is then handled as separately reviewed scope expansion.

## Non-goals

- Refactoring debug/settings routes for testability.
- Replacing or expanding scenario-world APIs.
- Mirroring the entire unit-test matrix through HTTP stories.
- Changing coverage thresholds or acceptance rules to make the target pass.

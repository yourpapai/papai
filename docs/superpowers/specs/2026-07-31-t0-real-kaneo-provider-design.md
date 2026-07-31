<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: real Kaneo provider inside the T0 story lane

**Status:** approved

**Date:** 2026-07-31

## Context

The T0 story lane now exercises the real YouTrack plugin through a stateful
host-scoped simulator, but it still shadow-registers Kaneo with
`MemoryTaskProvider`. As a result, `plugins/task-provider-kaneo` remains
invisible to T0 despite the Docker-backed Tier 1 parity suite exercising the
same 29 `PARITY_GROUPS` against a real Kaneo container.

This cycle makes the real Kaneo plugin reachable from T0. It follows the
already-shipped YouTrack architecture rather than the earlier proposal's
`given.realTaskProvider()` and `expectAnyOrder()` APIs: plugin approval must
exist before runtime construction, and `StrictHttpDispatcher.serveHost()` is
the required unordered, stateful-host transport.

## Goals

- Exercise the real Kaneo plugin from manifest approval through task-provider
  resolution and REST calls in `bun run test:stories`.
- Run all 29 existing shared `PARITY_GROUPS` through a stateful fake Kaneo API;
  no Kaneo parity group is excluded.
- Add four real-Kaneo chat-loop stories equivalent to the real-YouTrack proofs:
  activation/create, field mapping, error translation, and group capability
  behavior.
- Ensure plugin-created Kaneo providers use the runtime-owned HTTP transport.

## Non-goals

- Replacing `MemoryTaskProvider` as the default provider for existing stories.
- Changing the Tier 1 Docker-backed Kaneo parity lane or its catalog entries.
- Adding `given.realTaskProvider()` or `expectAnyOrder()`.
- Modeling Kaneo endpoints outside the operations required by the 29 shared
  parity groups and four chat-loop stories.

## Design

### Pre-start real-provider option

`ScenarioOptions.realTaskProvider` widens from `'youtrack'` to
`'youtrack' | 'kaneo'`. It remains a scenario option because a real plugin is
only activated after its manifest has been approved during world construction;
`given.*` runs too late.

The scenario world uses a provider descriptor keyed by provider type. Each
descriptor declares the plugin to approve, deterministic instance
configuration, the simulator host, and the `serveHost()` responder. During
world construction it approves the selected plugin before runtime startup and
registers that provider's simulated host. Ordinary scenarios retain the
existing memory-backed `kaneo` registration.

### Stateful fake Kaneo API

`tests/stories/harness/fake-kaneo/` contains a transport-free state and router,
plus a responder adapter that turns a `Request` into router input. State is
fresh per scenario and contains only the resources needed by parity and the
four chat stories: workspace metadata, projects, columns, tasks, comments,
labels, relations, and members.

The router returns Kaneo-shaped JSON payloads and errors. Unknown routes and
unsupported method/path pairs return explicit API errors; invalid request
shapes do not mutate state. This keeps the host simulator strict even though it
does not require a predetermined request order.

`StrictHttpDispatcher.serveHost()` remains the only unordered mode. It gives
the simulator exclusive ownership of its host, preserves FIFO `expect()`
semantics for every other host, records requests and responses, and verifies
that the simulator received at least one request unless explicitly exempted.

### Runtime transport propagation

The Kaneo plugin activation captures a provider-runtime facade. Its registered
factory derives an instance-scoped `httpFetch` from the factory configuration,
then passes that callable through entry-runtime into `KaneoConfig.fetch`.
Kaneo declares `baseUrl` as its instance host key; the facade validates that
configured URL host before creating the callable, so tool input never changes
the allowlist. `kaneoFetch()` uses the injected callable when supplied. The
transport type is the callable provider-runtime contract, not `typeof fetch`,
so it does not require Bun-specific static properties such as `preconnect`.

### T0 coverage

The Kaneo conformance story suite partitions all 29 `PARITY_GROUPS` into
literal story scenarios, so the manifest extractor can discover them. It
asserts at module setup that every group is included exactly once. Each group
creates its own project to preserve its clean-state assumption; each scenario
has a new fake-Kaneo state. There are no exclusions.

Four additional real-Kaneo chat-loop stories prove:

1. Manifest approval, activation, real provider resolution, and project
   creation through fake REST.
2. Status and priority field mapping for a created task.
3. A fake 404 translated through Kaneo's provider error handling into a
   model-visible tool failure.
4. Group-context member-provision capability advertisement and execution,
   proving the real Kaneo provider rather than the memory fake served the turn.

## Testing

- Unit/contract tests cover fake-Kaneo state isolation, representative routing,
  malformed and unknown requests, real-provider registration ownership, and
  factory-to-client transport propagation.
- `bun run test:stories:contracts` validates the frozen harness contracts.
- `bun run test:stories` validates all 29 Kaneo parity groups and four
  chat-loop stories in the sandbox.
- `bun run lint` and `bun run typecheck` validate source and type contracts.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Fake and provider share a mistaken API interpretation | Tier 1 Docker parity remains the independent real-Kaneo check. |
| Simulator becomes a permissive fallback | Unknown and unsupported routes return explicit errors; no catch-all success behavior is allowed. |
| A parity group is silently omitted | A module-level exact partition assertion fails before a scenario runs. |
| Plugin factory bypasses the story transport | A focused factory-to-client test proves the injected runtime fetch is selected. |
| Existing stories accidentally switch providers | Memory Kaneo registration remains the default; the real provider is opt-in per scenario. |

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: ACP lifecycle hermetic coverage

**Date:** 2026-07-13
**Status:** Approved design; awaiting written-spec review
**Source catalog:** `~/Projects/kontur/kiss-code_review-papai/papai/scenarios/catalog.md`

## Goal

Make every remaining `SCN-coding-acp-*` catalog record executable as a deterministic, hermetic end-to-end story. The stories qualify the trusted-module ACP implementation through the production chat, tool, persistence, and guarded HTTP composition path.

## Scope

Phase 2 covers the remaining ACP lifecycle, policy, MCP, forge-preflight, and declared Magi-failure records:

- PR-backed session start and self-hosted forge preflight;
- cautious permission resolution;
- list, status, local project discovery, and Magi agent discovery;
- finish by push and PR, cancel, and continue by session or PR;
- MCP-backed session start and MCP failure handling; and
- the happy, denial, malformed-input, missing-configuration, and declared upstream-failure branches required by those records.

Already executable Phase 1 records remain unchanged: fresh start, not-configured start, guest denial, operator denial, and ACP command. Nerv, supervision, generic settings/HTTP, and non-ACP catalog records remain out of scope.

## Architecture

New stories live under `tests/stories/integrations/coding-sessions/` and use only the public `ScenarioWorld` API. They enter production composition through real module contributions and scripted LLM tool calls; they do not call ACP tools, registries, or stores directly as an end-to-end oracle.

The fake Magi evolves into a strict stateful protocol fixture. It exposes only the routes actually used by ACP: session start/list/status, permissions, finish, cancel, follow-up, and agents. Every request is authorization-checked, validated, sanitized into an event, and rejected unless declared by the story. It stores just enough declared session and permission state to make lifecycle continuations observable without modeling Magi or Geofront internals.

```text
ScenarioWorld + scripted LLM
  -> coding trusted-module contributions
  -> ACP tool and policy assembly
  -> guarded injected HTTP client
  -> strict fake Magi protocol
  -> real ACP session records + user reply
```

## Story model and coverage ledger

Each remaining catalog record receives a literal `SCN-coding-acp-*` story name and a precise ledger mapping after its story is manifest-resolvable. Related records may share fixture setup, but remain separate tests and assertions.

The Phase 1 frozen story files are never rewritten. Phase 2 stories become a new frozen compatibility input once authored on the qualified baseline. If compatibility later exposes a production defect, only production composition changes to satisfy the unchanged stories.

## Required behavior and safety assertions

Every story proves:

1. a user-visible reply or result;
2. an expected composition effect, such as a persisted local session record or one sanitized fake-Magi request; and
3. an applicable safety invariant: no unexpected request, record, cross-context access, capability exposure, or secret-bearing event.

Specific rules:

- PR starts include `prNumber` and require a forge token. Self-hosted repos without configured forge settings fail before Magi.
- Permission resolution reads declared pending calls and posts one allow or deny decision per call. Empty pending lists create no decision requests.
- List results contain only local chat-known sessions. Continue by PR searches only the chat's locally known completed sessions.
- Project discovery is local and causes no Magi request; agent discovery uses guarded Magi HTTP.
- Finish, cancel, status, and follow-up preserve declared Magi errors without creating false local records.
- MCP session starts assert sanitized MCP identity/token propagation. Invalid or unresolved MCP settings fail closed before session creation and do not disclose credentials.

## Harness constraints

Harness changes are allowed only for an observed ACP protocol boundary unavailable through the current public scenario API. Fake-Magi state is test-only, deterministic, and does not create an alternate ACP execution path. Existing I/O guards, deterministic clock and IDs, scoped storage model, and no-secret event policy remain mandatory.

## Qualification

Phase 2 is complete only when all ACP catalog entries are executable, the ledger maps every one to literal manifest IDs, and these pass:

- focused ACP stories and fake-Magi contracts;
- `bun test:stories:contracts`;
- `bun test:stories`;
- `bun test:stories:stress`;
- story manifest and catalog-ledger checks; and
- relevant coding module, MCP, and type checks.

## Non-goals

- Simulating Magi's Geofront process, container runtime, or real forge network.
- Rewriting Phase 1 frozen stories.
- Making Nerv or supervision records executable.
- Treating direct unit coverage as an end-to-end story.

## Self-review

- Scope includes every remaining ACP catalog record and explicitly excludes other families.
- Fake-Magi behavior is limited to observed HTTP protocol boundaries.
- Each record requires user, composition, and safety oracles.
- No catalog record is silently left pending within ACP scope.

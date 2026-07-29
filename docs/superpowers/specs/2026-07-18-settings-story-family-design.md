<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Settings HTTP story family (Tier 0 coverage expansion A)

**Date:** 2026-07-18
**Status:** Approved design; pending specification review

## Program context

Tier 0 story coverage expands as a program of independent specs, one per behavior
family, each with its own spec → plan → implementation cycle:

| #   | Sub-project                                           | Status                                                      |
| --- | ----------------------------------------------------- | ----------------------------------------------------------- |
| A   | Settings HTTP story family (this spec)                | Specified here                                              |
| B   | Tool permissions and confirmations                    | Not started; needs interaction simulation in `ScenarioChat` |
| C   | Deterministic background-services seam (virtual time) | Not started; pure infra                                     |
| D   | Memory family (5 IDs)                                 | Blocked by C for sweeps                                     |
| E   | Deferred and recurring family (8 IDs)                 | Blocked by C for firing                                     |

A, B, and C are independent. This spec covers only A.

## Goal

Map the 10 implementable pending `SCN-settings-*` catalog IDs to executable Tier 0
stories, raising ledger coverage from 19 to 29 executable scenarios. Every scenario is
**qualification-style**: it proves the setting changed through the real HTTP write path
**and** that the change alters observable behavior (next chat turn, session start, or
settings authorization). Contract-only stories are not accepted as coverage.

Two IDs are explicitly deferred: `SCN-settings-admin-mcp-catalog` and
`SCN-settings-admin-mcp-plugin-servers`. Their behavioral proof requires MCP-sourced
tools in a chat turn, which requires a fake-MCP-server seam that does not exist. They
move to a later MCP-focused spec (also covering `SCN-http-mcp-plugin`).

## Decision

Three new story files under `tests/stories/settings/`, plus small harness fixture
additions. No production `src/` changes are anticipated; if a story exposes a real bug,
the fix lands as its own commit, separate from the story.

### Harness additions

1. `given.settingsAdminSession(user)` (`tests/stories/harness/scenario.ts`,
   `fixtures.ts`) — seeds the user into system access as admin before the auth-code
   exchange, then returns the same `SettingsSessionHandle` as `settingsSession`. The
   non-admin denial path remains provable by calling admin routes with a plain
   `settingsSession` (expect 403).
2. Fixture seeds for a second task-instance template and per-user identity-mapping
   targets (`fixtures.ts`); today only one platform instance and one identity exist.
3. No other seams. Roster announcements ride the existing synchronous membership-add
   path; no background services, virtual time, or new fakes are introduced.

Ledger mappings in `tests/stories/catalog/coverage.ts` land with each file;
`catalog-coverage.test.ts` mechanically enforces the new counts.

### File 1: `settings/context-and-instances.story.test.ts`

- **SCN-settings-bootstrap** — bootstrap a fresh context via the API. Proof: before,
  context routes are empty; after, config is served and a chat turn runs on the
  bootstrapped defaults.
- **SCN-settings-identity** — PATCH per-user tracker identity. Proof: the next turn
  resolves assignee `me` to the new mapping (mirrors `context/group-users` but the
  mutation flows through HTTP, not a fixture).
- **SCN-settings-instances** — add a second task instance via settings. Proof: it
  becomes assignable, and assigning it makes the next turn land tasks on it.
- **SCN-settings-context-config** — update context config (tool preset or model).
  Proof: `world.model.inspections()` on the next turn shows the changed advertised
  toolset or model fingerprint.

### File 2: `settings/coding-surfaces.story.test.ts`

- **SCN-settings-coding-forge** — save a forge connection via HTTP. Proof: ACP session
  start on a self-hosted repository passes preflight (today that path is fixture-seeded;
  here it flows through the real settings write path).
- **SCN-settings-coding-mcp** — save MCP upstream config. Proof: session start forwards
  the exact config to fake-magi; malformed config fails closed with state intact.
- **SCN-settings-coding-repos** — register a repository. Proof: `list-projects`
  includes it and session start resolves it.

### File 3: `settings/admin-surfaces.story.test.ts`

- **SCN-settings-admin-guardrails** — flip a guardrail via admin session. Proof: the
  affected member action flips allowed↔denied in chat.
- **SCN-settings-admin-system-access** — grant admin to a member. Proof: their admin
  request goes 403 → 200; revoke returns it to 403.
- **SCN-settings-admin-roster-announce** — toggle roster announcements. Proof: a
  membership-add produces a group announcement captured by `ScenarioChat` when on, and
  is suppressed when off.

## Error handling and negative paths

Three layers asserted per story, as explicit `then.responseStatus` checkpoints:

1. **HTTP contract** — 401 unauthenticated, 403 missing CSRF, 403 non-admin on admin
   routes, 403 cross-context access, 400 malformed body.
2. **Fail-closed writes** — invalid values (bad forge URL, malformed MCP JSON, unknown
   instance id) must not mutate state: assert the error status, read back the prior
   value intact, and confirm the behavioral turn still works as before.
3. **Secret hygiene** — credential-bearing responses mask values; the sanitized event
   trace is asserted to not contain the secret.

No new failure-injection machinery: strict-http and the scripted model already fail the
run on any undeclared call.

## Verification

- TDD per file: story first (red), then fixture additions, then green.
- `bun test:stories:contracts` — including new unit tests for the fixture additions.
- `bun test:stories` — sandboxed, stays in the ~3 s class.
- `bun test:stories:stress` once before merge — 10× randomized, no flakes, no retries.
- Typecheck and lint.
- **Baseline reset:** frozen harness bytes change, so `bun test:stories:compat` against
  a pre-branch baseline reports harness files as changed by design. Refactor
  qualification re-baselines at the merge commit; this is expected, not a regression.

## Non-goals

- The two deferred MCP-admin IDs and any fake-MCP-server seam.
- Virtual time, background services, scheduler-dependent scenarios (sub-project C).
- Mattermost/Discord surfaces, real transports, or Tier 1+ behavior.
- Production `src/` refactors; bug fixes discovered en route land separately.

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0228: ACP Plugin Phase-3 Cleanup

## Status

Implemented (with divergence)

## Date

2026-06-26

## Context

ADR-0218 shipped the `acp` plugin as a thin HTTP client of `magi`, and ADR-0227 (Phase 3) layered user-defined repositories and the inline `projectSpec` on top of it. After Phase 3 landed, the plugin source carried two pieces of debt that the cleanup plan (`docs/superpowers/plans/2026-06-26-acp-cleanup.md`) targeted:

1. **A `max-lines` smell in `plugins/acp/tools.ts`.** All nine tool factories plus the shared types/helpers lived in one file; Phase 3's `buildSessionProjectSpec`/`canDeriveForge` additions pushed it toward the repo's per-file line ceiling. The plan splits the session-lifecycle tools into a sibling `session-tools.ts`, leaving read/utility tools and shared helpers in `tools.ts`.
2. **A dead `project` field.** Phase 3 made the catalogue the source of truth and replaced the top-level `project` string in the `POST /sessions` and `POST /reviews` bodies with the richer inline `projectSpec`. The stale `project` field was still being sent in two POST bodies; the plan removes it.
3. **A scope-model test gap.** `buildCodingReposFacade` (ADR-0227) resolves repos at the config context, but no test proved the thread-scope → config-context resolution path that group threads rely on.
4. **A CSRF coverage gap.** The repos DELETE fetcher (`deleteRepo`) had no CSRF-header assertion, while the POST fetcher (`addRepo`) did.

No distinct design spec exists for this cleanup; the plan is self-contained (the only `*acp*` spec under `docs/superpowers/specs/` is the later, unrelated `2026-07-05-acp-transcript-web-viewer-design.md`).

## Decision Drivers

- **`max-lines` is a design signal, not a quota.** Per repo convention a per-file ratchet failure means the file does two jobs; the fix is to split, not to compress.
- **Static-graph discipline.** The split must preserve the plugin's bare-module-free static graph — `session-tools.ts` may import only sibling plugin files (`./client.js`, `./schemas.js`, `./tools.js`), never `src/` or `zod`.
- **Dead fields are a contract hazard.** Sending a stale `project` alongside the authoritative `projectSpec` invites a papai/magi disagreement on which field wins; the field the catalogue superseded must be dropped from the wire.
- **Test the scope model that production relies on.** Group threads reach their repos through thread-scope → config-context resolution; that path must be covered, not just the DM (un-suffixed) path.
- **Symmetric CSRF coverage.** Every state-changing settings fetcher should have a CSRF-header assertion; DELETE is state-changing.

## Considered Options

### Option A — Split into `tools.ts` (read/utility) + `session-tools.ts` (write/lifecycle); drop `project`; add the two tests (chosen)

A mechanical, in-place refactor: extract the seven session tool factories into a new sibling file, trim `tools.ts` to shared types + `getTool`/`listProjectsTool`, import both from `index.ts`, drop the dead `project` field from the two POST bodies, and add the thread-scope and DELETE-CSRF tests.

- **Pros:** keeps each file under the line ceiling with a clear read/write split; preserves the static graph (sibling imports only); removes a genuine wire-level dead field; closes two real test gaps with verbatim-from-plan assertions; no business-logic change.
- **Cons:** spreads the tool surface across two files (a minor navigation cost); the `project` removal is a wire-format change that must land with the matching magi expectation.

### Option B — Inline the split by extracting fewer helpers / compressing formatting

Keep one file but claw back lines by deleting blank lines and compacting the tool factory boilerplate.

- **Pros:** no new file.
- **Cons:** explicitly rejected by repo convention — `max-lines`/`max-lines-per-function` failures are a design signal, and gaming the limit by compressing formatting is forbidden. Does not address the dead field or the test gaps.

### Option C — Leave `tools.ts` oversized; only drop `project` + add tests

Skip the split, address only the field and the tests.

- **Pros:** smallest diff.
- **Cons:** leaves the `max-lines` smell in place and the read/write tools interleaved; fails the primary driver.

## Decision

All four cleanup items shipped. The split landed as planned (with the `review_pr` tool since removed by ADR-0227's evolution — see Divergences), the dead `project` field is gone from the `start_session` POST body, and both tests were added verbatim.

### Key choices

- **Read/write split.** `plugins/acp/tools.ts` keeps the shared `RuntimeContext`/`Tool`/`RepoEntry` types, the `ACP_CAPABILITIES` map, the `sessionIdOf`/`canDeriveForge`/`buildProjectSpec`/`buildSessionProjectSpec` helpers, and the read/utility tool factories (`getTool`, `listProjectsTool`). `plugins/acp/session-tools.ts` holds the write/lifecycle factories (`start`/`list`/`status`/`finish`/`cancel`/`answer_permission`). `index.ts` imports session tools from `./session-tools.js` and the rest from `./tools.js`.
- **`project` field dropped from the `start_session` body.** The `POST /sessions` payload now carries `agent`, `contextId`, `prompt`, `secrets`, optional `forgeToken`/`prNumber`/`mcpTokens`, and the authoritative `projectSpec` — never a bare `project`.
- **Thread-scope facade test.** `tests/plugins/coding-repos-facade.test.ts` adds a test that builds a thread-scoped storage context id via `toScopedThreadContextId`, stores a repo at the derived config context, and asserts `buildCodingReposFacade(...).list()`/`.get()` resolve it — proving the thread → config-context path.
- **DELETE CSRF test.** `tests/client/settings/repos-fetchers.test.ts` adds `deleteRepo attaches the CSRF header on DELETE`, mirroring the existing `addRepo` POST assertion.
- **Static graph preserved.** `session-tools.ts` imports only `./client.js`, `./schemas.js`, `./tools.js` (and, after later phases, `./session-records.js`) — all sibling plugin files; no `src/`, no `zod`.

## Consequences

### Positive

- Both plugin files sit comfortably under the per-file line ceiling (`tools.ts` 191 lines, `session-tools.ts` 238 lines) with a clear read/utility vs write/lifecycle split.
- The stale `project` field no longer crosses the papai→magi wire, eliminating a potential "which field wins" ambiguity against the authoritative `projectSpec`.
- The thread-scope repo-resolution path — the one group threads depend on — is now covered by a regression test.
- CSRF coverage on the settings repos fetchers is symmetric across POST and DELETE.

### Negative

- The tool surface is now spread across `tools.ts`, `session-tools.ts`, and (post-cleanup) `continue-tool.ts`, so navigating a single tool's implementation may cross files.
- The `project` removal was a wire-format change; any magi build still expecting the bare field would break. (Magi had already moved to `projectSpec`-only with Phase 3, so this was aligning papai with the standing contract.)

### Risks

- **Subsequent phases re-enlarged both files.** Later work (agent/provider picker, model selection, the MCP catalogue, transcript/share fields) added helpers and capability ids to `tools.ts` and richer pre-flight/MCP logic to `session-tools.ts`. Both remain under the ceiling today, but the cleanup's headroom has narrowed; a future split (e.g. a `project-spec.ts`) may be needed.
- **`review_pr` removal (post-cleanup) made the plan's Task 4.2 moot.** The cleanup plan assumed a `review_pr` tool; it was removed by ADR-0227's evolution (PR review via `start_session(prNumber)` + `continue_session`), so the plan's "remove `project` from `review_pr`" step no longer has a target. See Divergences.

## Related Decisions

- **ADR-0218: papai ACP Plugin** — the plugin whose `tools.ts` this cleanup splits and whose `project` field this drops.
- **ADR-0227: Phase 3 — User-Defined Repositories & Inline Project Spec** — established `projectSpec` as the authoritative project source, making the bare `project` field dead; its later evolution also removed `review_pr`, superseding the cleanup's Task 4.2.
- **ADR-0221 / ADR-0222** — the credential-vault phases whose `codingSecrets`/`forgeToken` request fields ship alongside the (now field-cleaned) `projectSpec`.
- **ADR-0123: Trusted-Local Plugin System** — the static-graph rule the split had to preserve.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`:

| File | Role | Evidence |
| --- | --- | --- |
| `plugins/acp/session-tools.ts:1` | New file; write/lifecycle tool factories (`startSessionTool` `:64`, `listSessionsTool` `:114`, `sessionStatusTool` `:139`, `finishSessionTool` `:155`, `cancelSessionTool` `:190`, `answerPermissionTool` `:206`). 238 lines (under 300). | `read` + `wc -l` confirm. |
| `plugins/acp/session-tools.ts:98` | `start_session` POST body — `agent`, `contextId`, `prompt`, `secrets`, optional `forgeToken`/`prNumber`/`mcpTokens`, `projectSpec`; **no `project` field**. | `read` confirms (`:98-107`). |
| `plugins/acp/tools.ts:1` | Trimmed to shared types (`RuntimeContext` `:17`, `Tool` `:55`, `RepoEntry` `:75`), `ACP_CAPABILITIES` `:63`, helpers (`sessionIdOf` `:83`, `canDeriveForge` `:102`, `buildProjectSpec` `:111`, `buildSessionProjectSpec` `:142`), and read/utility factories (`getTool` `:161`, `listProjectsTool` `:181`). 191 lines (under 300). | `read` + `wc -l` confirm. |
| `plugins/acp/index.ts:8` | Session tools imported from `./session-tools.js` (`:8-15`); `getTool`/`listProjectsTool`/`ACP_CAPABILITIES` from `./tools.js` (`:16`); `continueSessionTool` from `./continue-tool.js` (`:7`, post-cleanup). | `read` confirms. |
| `plugins/acp/schemas.ts:62` | Exports `continueSessionSchema`; **no `reviewPrSchema`** — confirms `review_pr` removal. | `grep` confirms. |
| `tests/plugins/coding-repos-facade.test.ts:86` | Thread-scope test `'list and get resolve repos stored at the config-context when called with a thread-scoped storage context id'`, using `toScopedThreadContextId` + `getConfigContextIdFromStorageContextId` (imported `:8`). Verbatim from the plan. | `grep` confirms. |
| `tests/client/settings/repos-fetchers.test.ts:113` | `deleteRepo attaches the CSRF header on DELETE` test, asserting `X-Settings-CSRF: csrf-del`. Mirrors the `addRepo` POST test (`:99`). Verbatim from the plan. | `grep` confirms. |
| `tests/plugins/acp/start-session.test.ts:40` | `capturedBody.toEqual({...})` for `start_session` asserts `projectSpec` and **no top-level `project`** (the `project` arg is still the tool *input* at `:39`, just not forwarded). | `grep` confirms. |
| `tests/plugins/acp/review-command.test.ts:43` | No longer asserts a `review_pr` POST body — repurposed to the `/acp` command help text (`:43`) and the `acp-hint` fragment (`:56`). | `grep` confirms. |

### Divergences from the plan

- **`reviewPrTool` is absent; the planned `review_pr` split/field-removal target no longer exists.** The plan's `session-tools.ts` carried seven factories including `reviewPrTool`, and Task 4.2 updated `review-command.test.ts` to drop `project` from the `review_pr` body. ADR-0227's evolution removed `review_pr` entirely (PR review is now `start_session(prNumber)` + `continue_session` via `plugins/acp/continue-tool.ts`), so the shipped `session-tools.ts` has six factories, `schemas.ts` exports `continueSessionSchema` instead of `reviewPrSchema`, and `review-command.test.ts` tests the `/acp` command/fragment rather than a review POST body. The cleanup's *intent* (no dead `project` on session-starting bodies) is met by `start_session` alone.
- **`tools.ts` is 191 lines, not the ~80 the plan predicted.** Later phases added `ACP_CAPABILITIES`, `canDeriveForge`, `shareFieldsOf`, `McpUpstream`, and the enriched `buildSessionProjectSpec` (Phase 3 + agent/provider picker + model + MCP catalogue). Still well under the 300 ceiling, so the split's purpose holds.
- **`session-tools.ts` is richer than the planned 190-line skeleton.** Each tool gained a `capabilityId` (capability-gating, ADR-0203/0204), `start_session` gained `resolveStartSessionAccess` pre-flight, `prNumber`, agent/MCP-server/MCP-token resolution, `recordStartedSession`, and `list_sessions` enriches via `session-records.ts`. All post-cleanup phase additions layered on the split structure this cleanup established.
- **`SESSION_FILTERS` dropped `'review'`.** The plan's list was `['new','active','waiting','review','done']`; the shipped list (`session-tools.ts:28`) is `['new','active','waiting','done']`, consistent with the `review_pr` removal.

All four cleanup outcomes are present in the codebase: the `tools.ts` split (both files under the ceiling), the dead `project` field removed from the `start_session` POST body, the thread-scope `codingRepos` facade test, and the DELETE CSRF assertion.

The source plan `docs/superpowers/plans/2026-06-26-acp-cleanup.md` is archived alongside this ADR to `docs/archive/` (no distinct design spec existed for this cleanup).

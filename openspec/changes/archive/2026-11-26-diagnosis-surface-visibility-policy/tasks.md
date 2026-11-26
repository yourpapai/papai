<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Diagnosis surface visibility policy

## 1. Log-entry anonymity-safe shaping helper

- [x] 1.1 Extend `tests/debug/log-buffer.test.ts` with failing assertions for a
      pure shaping helper: keeps `level`, `time`, `msg`, `scope`, `turnId` plus
      any additional keys whose value is `number`/`boolean`; drops every other
      key (strings, objects, arrays); idempotent on already-safe entries.
      Verify: `bun test tests/debug/log-buffer.test.ts` (fails)
- [x] 1.2 Implement the helper in `src/debug/log-buffer.ts` (no new module).
      Verify: `bun test tests/debug/log-buffer.test.ts` (passes)

## 2. LLM trace attribution and shaping

- [x] 2.1 Extend `tests/debug/llm-trace-collector.test.ts` with failing
      assertions: `llm:end`/`llm:error` traces copy `data.chatUserId` into a new
      `LlmTrace.chatUserId` (absent → undefined, legacy shapes unchanged).
      Verify: `bun test tests/debug/llm-trace-collector.test.ts` (fails)
- [x] 2.2 Add `chatUserId` to `buildEndTrace`/`buildErrorTrace` in
      `src/debug/llm-trace-collector.ts`.
      Verify: `bun test tests/debug/llm-trace-collector.test.ts` (passes)
- [x] 2.3 Add failing assertions for a trace shaping helper (same file):
      non-own traces drop `generatedText`, `stepsDetail`, and
      `toolCalls[].args`/`toolCalls[].result`, keeping `toolName`, durations,
      success flags, model ids, token/step counters; own traces pass verbatim;
      idempotent. Implement it next to trace construction.
      Verify: `bun test tests/debug/llm-trace-collector.test.ts`

## 3. Per-session visibility in the state collector

- [x] 3.1 Write failing per-session tests (new
      `tests/debug/per-session-visibility.test.ts` plus updates in
      `tests/debug/sse-log-filter.test.ts`): `addClient(controller, filter,
      adminUserId)` binds the session admin; `log:entry` egress applies
      attribution (explicit `chatUserId` → own; `turnId` resolvable via
      `findTurnById` with turn scope visible to that admin → own; else shaped)
      and runs the connection filter (incl. `q`) **after** shaping; non-log
      events skip clients failing `isVisibleToAdmin(event.scope, clientVis)`;
      `llm:full` shaped via `trace.chatUserId`; `state:init` built per admin
      (`getSessionSnapshots(clientAdminId)`, foreign `recentTurns` /
      `recentNotifications` / `recentToolFailures` excluded, `recentLlm`
      included but shaped; scheduler/pollers/messageCache/stats unchanged).
      Verify: `bun test tests/debug/per-session-visibility.test.ts tests/debug/sse-log-filter.test.ts` (fails)
- [x] 3.2 Edit `src/debug/state-collector.ts`: delete `adminUserId` /
      `adminVisibility` module state, `init()`, and
      `isScopeVisibleToCurrentAdmin`; registry value becomes
      `{ filter, adminUserId }`; `onEvent` loses its visibility early-return
      (assembly + stats always run); per-client checks live in `broadcast` and
      the per-admin `state:init`; attribution-aware log egress + trace shaping
      use the §1–2 helpers. Update stale `init()` callers
      (`tests/debug/state-collector-lifecycle.test.ts`, `sse-log-filter.test.ts`,
      any other importer) in the same edit.
      Verify: `bun test tests/debug/` (per-session, sse-log-filter,
      state-collector*, turn-assembly suites pass)
- [x] 3.3 Sweep `src/` for pino sites that log user-controlled content without
      `chatUserId`/`turnId` attribution and attach the missing field (fail-safe
      direction: unattributable content strips for everyone).
      Verify: `bun run test:affected` + `bun run lint`

## 4. REST routes: session threading, `/logs` egress, `/turns/:id`, 405 guards

- [x] 4.1 Re-attribute the fixtures in `tests/debug/logs-route-content.test.ts`
      with `chatUserId` so the existing "unredacted" expectations describe the
      session admin's own entries (stays green before implementation).
      Verify: `bun test tests/debug/logs-route-content.test.ts` (passes)
- [x] 4.2 Add failing route tests: a second admin's session gets own-attributed
      entries verbatim and foreign/unattributable entries shaped on `GET /logs`
      (with `q` matching only post-shaping content and `/logs/stats`
      `matchingCount` computed post-shaping); `/turns/:id` returns 404 for a
      turn invisible to the requesting session's admin even when visible to the
      process's primary admin, 200 + full turn for the owning admin; POST/PUT/
      PATCH/DELETE on `/events`, `/logs`, `/logs/stats`, `/logs/scopes`,
      `/turns/*`, `/stats/global`, `/stats/subject/*` return 405 (extend
      `tests/debug/server.test.ts`, `logs-route-content.test.ts`,
      `server-stats.test.ts`).
      Verify: `bun test tests/debug/server.test.ts tests/debug/logs-route-content.test.ts tests/debug/server-stats.test.ts` (fails)
- [x] 4.3 Edit `src/debug/server.ts`: `isAuthorizedRequest` returns the
      `AuthenticatedRequest`; thread `session.adminUserId` into `handleEvents`
      (→ `addClient`), `handleLogs` (attribution + shaping +
      filter-after-shape, `limit`/`before` last), and `handleTurnLookup`
      (`isVisibleToAdmin(turn.scope, sessionVis)`, 404 unchanged); add GET-only
      guards to the diagnosis routes; drop the `init()` call from
      `startDebugServer` (signature unchanged).
      Verify: `bun test tests/debug/` (all debug suites pass, incl.
      `admin-visibility`, `scope-visibility`, existing turns-404 tests)

## 5. Docs

- [x] 5.1 Write a new ADR at the next free slot (`docs/adr/04xx-…`, 0426+ at
      planning time): supersedes ADR-0224's "admin sees all users' content"
      posture (retaining its redaction-removal for visible scopes), records the
      per-session visibility model, anonymity-safe egress shape, and that
      ADR-0223's `/turns/:id` enforcement is now per-session; add it to the
      `docs/adr/README.md` index and mark ADR-0224 as superseded where the
      index tracks status.
      Verify: manual review; `bun run workflows:lint` unaffected (markdown only)
- [x] 5.2 Extend the anonymity-contract section in
      `docs/architecture/overview.md` to cover the diagnosis surface: per-session
      visibility principal, allowed/never-returned field classes for log egress,
      aggregate-only `/logs/stats` + `/logs/scopes`, GET-only enforcement.
      Verify: manual review against `specs/diagnosis-surface-visibility/spec.md`

## 6. Full gate

- [x] 6.1 Run the full suite and all checks: `bun run test`,
      `bun run typecheck`, `bun run lint`, `bun run check:full` (knip confirms
      no stale importers of the removed `init` /
      `isScopeVisibleToCurrentAdmin` exports); re-read `reports/test/` via
      `bun run test:failures` if anything trips; confirm the spec's scenarios
      and the proposal's verification list are all covered.
      Verify: all pass

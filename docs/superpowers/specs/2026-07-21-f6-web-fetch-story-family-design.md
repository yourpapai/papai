<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F6 web-fetch story family

**Status:** approved

**Date:** 2026-07-21

## Context

The coverage-expansion roadmap (`2026-07-19-story-coverage-expansion-roadmap-design.md`)
sequences family F6 (`web-fetch`) after F1–F5. `plugin-core-separation` rewires builtin
tool registration and runtime composition; F6's scenarios observe what that can break in
the **public web-fetch tool**: capability registration
(`src/tools/core-capabilities.ts:10-94`), context-gated assembly
(`src/tools/provider-independent-tools-builder.ts:131`), the per-actor quota gate
(`src/web/fetch-extract.ts:229`, `src/web/rate-limit.ts:70`), and the safe-fetch → distill
pipeline (`src/web/safe-fetch.ts:252`, `src/web/fetch-extract.ts:219`,
`src/web/distill.ts:166`).

The catalog audit (`docs/superpowers/plans/2026-07-19-story-catalog-audit.md`) classified
both F6 records `needs-seam:[capability-ids, public-url-assertion]`. This spec lands **2
executable scenarios** and moves the ledger from **95 to 97 executable** (33 → 31 pending),
putting behavioral tripwires on the web-fetch tool surface and its quota gate. It is the
family that **realizes and exhausts** the `public-url-assertion` seam: after F3 reclassified
`fetch-chat-link` off it (roadmap seam-drift table), F6 is its only consumer, and after F6
no pending scenario references it.

Research resolved two facts that simplify the family and one that corrects the audit; see
"Reclassifications and findings" below.

Research basis: the tool (`src/tools/web-fetch.ts`), assembly
(`provider-independent-tools-builder.ts:131`, `src/tools/tools-builder.ts:200-245`,
`src/tools/index.ts:271-280`), the fetch/quota/distill pipeline
(`src/web/fetch-extract.ts:60-256`, `src/web/safe-fetch.ts:43-291`,
`src/web/rate-limit.ts:15-72`, `src/web/distill.ts:80-203`), the `web_rate_limit`/`web_cache`
schema (`src/db/web-schema.ts`), capability registration
(`src/tools/core-capabilities.ts:96-100`), and harness mechanics (F5's `2026-07-21-f5-*`
spec; `tests/stories/harness/world.ts:438-457`, `scenario.ts` `createGiven`,
`fixtures.ts` `createScenarioFixtures`, `strict-http.ts`, `io-guard.ts:333-337`; existing
web-fetch unit tests `tests/tools/web-fetch.test.ts`, `tests/web/safe-fetch.test.ts`).

## The `assertPublicUrl` blocker (why a production seam is required)

Under `bun test:stories` the I/O guard patches `globalThis.fetch` to route through the
world's strict HTTP dispatcher (`io-guard.ts:333-337`), so `safeFetchContent`'s outbound
`deps.fetch(url.toString(), …)` (`safe-fetch.ts:266`) is transparently intercepted with no
extra plumbing. But `assertPublicUrl` is a **separate** call that runs first
(`safe-fetch.ts:264`, `await Promise.race([deps.assertPublicUrl(url), …])`) and performs a
real DNS `lookup()` (`safe-fetch.ts:101,121`) that the guard cannot intercept — the guard
blocks it as live network I/O. So a story cannot reach the interceptable fetch without a
seam that bypasses the DNS assertion.

The world already constructs `assertPublicUrl: () => Promise.resolve()` for **plugin**
egress (`world.ts:438`, `ProviderRuntimeDeps`), but that channel feeds only
`startProductionExtensions`/`routeRequest` — it never reaches `web_fetch`, a core tool built
per-turn inside the orchestrator. And the entire tool-assembly chain
(`makeTools → buildToolDescriptors → buildTools → addProviderIndependentTools →
makeWebFetchTool`) threads **no deps object**: `provider-independent-tools-builder.ts:131`
calls `makeWebFetchTool(contextId, chatUserId, contextType)` with no 4th argument, so
production always uses the real `assertPublicUrl` via `defaultDeps`. The world's `buildModel`
override rides a different path (`processMessage` → `prepareLlmInvocation(opts)` is called
with one argument at `llm-orchestrator.ts:171`), so it does not flow into tool building
either.

## Production seams (two — each lands first and is reviewed independently, rule 2)

F6 has two production changes. Per rule 2 each lands as its own commit and is reviewed alone
before any harness seam or story consumes it.

### 1. `capability-ids` — capability registration for `web_fetch`

`web_fetch` carries no capability id today; `CORE_TOOL_CAPABILITIES`
(`src/tools/core-capabilities.ts:10-94`) covers `tasks.*`, `meta.*`, memory/memo/instruction,
history, and the F5 scheduling additions, but not web fetch. The scripted model addresses
tools with the existing `callCapability(id, input)` decision, so F6 adds one entry:

| Capability id | Wire name   |
| ------------- | ----------- |
| `web.fetch`   | `web_fetch` |

Registration is unchanged: `registerOfferedCoreToolCapabilities`
(`src/tools/core-capabilities.ts:96-100`) iterates the map and registers the wire name **only
when present in the offered set**. `web_fetch` is offered whenever `contextId` is defined
(`provider-independent-tools-builder.ts:131`), so conditional gating is honored for free.
This is the roadmap's `capability-ids` seam.

### 2. `public-url-assertion` — module-scoped override of `assertPublicUrl`

Realizes the reserved `public-url-assertion` seam id (never used before F6). The change is
contained to `src/web/safe-fetch.ts`: a module-scoped overridable default that the harness
sets and clears, read by `defaultDeps.assertPublicUrl`:

```typescript
let assertPublicUrlOverride: ((url: URL) => Promise<void>) | undefined

export const setAssertPublicUrlForTesting = (fn?: (url: URL) => Promise<void>): void => {
  assertPublicUrlOverride = fn
}

const defaultDeps: SafeFetchDeps = {
  fetch,
  assertPublicUrl: (url) => (assertPublicUrlOverride ?? assertPublicUrl)(url),
}
```

Because `makeWebFetchTool → fetchAndExtract → safeFetchContent` all resolve to these module
defaults (no deps are threaded through assembly), the override propagates to `web_fetch`
with **zero threading** and touches **no compat-DI seam shape** (`LlmOrchestratorDeps`,
`MakeToolsOptions`, `buildTools`, or the frozen `createProductionRuntimeDeps`/`buildModel`
surface). It is the smallest change that reaches the tool.

**Chosen over a DI thread.** The alternative — an optional `assertPublicUrl` on
`LlmOrchestratorDeps`, forwarded through `prepareLlmInvocation → buildFullToolSet → makeTools
→ MakeToolsOptions → buildTools → addProviderIndependentTools → makeWebFetchTool` — has no
module state (F5's stated preference for `scheduler-chat-di`) but is a 5–6-hop change across
the frozen compat-DI surface. Here the module override is one file, follows the established
`given.notifyToken` module-cache precedent (F4, `resetNotifyTokenCacheForTesting`), and keeps
the production change entirely inside the web module. The trade-off is mutable module state,
mitigated exactly as notify-token is: the harness sets it in a `given.*` seam and clears it
in `fixtures.teardown`, with a contract test proving per-scenario isolation.

This is a **realized reserved seam** (already in `STORY_SEAM_IDS`); no new seam id is added.

## Harness seams (harness-only, land before any story, each with a contract test)

All additions are under `tests/stories/harness/`, each with its own contract test in
`scenario.test.ts`, and land before any story consumes them (rule 2).

- **`given.allowPublicUrl()`** — calls `setAssertPublicUrlForTesting(() => Promise.resolve())`
  via a new `fixtures` method; `fixtures.teardown` calls `setAssertPublicUrlForTesting(undefined)`
  to restore the real guard (the `given.publicBaseUrl` / `given.notifyToken` set-and-restore
  precedent, `fixtures.ts:324-333`). Contract test: asserts the override is active inside the
  scenario and cleared afterward — the notify-token isolation shape (`scenario.test.ts:521-539`).
- **`given.exhaustedWebFetchQuota(context)`** — seeds a `web_rate_limit` row directly via
  drizzle (the `given.recurringTask` → `seedTestRecurringTask` precedent): `actorId` = the
  tool's actor, `windowStart = Math.floor(nowMs / 300000) * 300000` aligned to the world's
  fixed clock (`FIXED_NOW = '2026-01-01T00:00:00.000Z'`, `world.ts:36`), `count = 20` (the
  `LIMIT`, `rate-limit.ts:16`). `consumeWebFetchQuota`'s guarded `UPDATE … WHERE count < 20`
  then affects zero rows and returns `{ allowed: false, … }` (`rate-limit.ts:39-66`). Contract
  test: seed → call `consumeWebFetchQuota(actorId, FIXED_NOW_MS)` → expect `allowed: false`.

**Actor-id keying (plan-discovery).** For `web_fetch` the quota `actorId` is
`input.actorUserId ?? input.storageContextId` (`fetch-extract.ts:224`), where `actorUserId`
is the `chatUserId` passed at `provider-independent-tools-builder.ts:131`. The seed must match
whatever id the scenario's tool call resolves to (DM: the user's chat id). A plan-discovery
step confirms the exact id against the existing assertions in
`tests/tools/web-fetch.test.ts:112-113,145-147` (`actorId: chatUserId`).

## Story files

New `tests/stories/web/web-fetch.story.test.ts` (2). Every scenario qualifies through
observable behavior — a real tool result, a durable change observed on a following turn, or a
quota flip on the real tool result (rule 3 — never a scripted reply string alone; F5's
observation model).

| Scenario                        | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-web-fetch`                 | `given.allowPublicUrl()` + one `world.http.expect({ method: 'GET', url })` serving a **small (< 8000-char) HTML page** carrying a unique token → model `callCapability('web.fetch', { url })` → the token, sourced from the intercepted body (not scriptable), surfaces on the real tool result/reply. **Durable anchor:** a second same-URL `web_fetch` turn is served from the `web_cache` write under the _same single_ declared expectation — a second outbound call would fail strict-HTTP `verifyConsumed`, proving the durable cache. |
| `SCN-web-fetch-rate-limit-deny` | `given.exhaustedWebFetchQuota()` → model `callCapability('web.fetch', { url })` → the tool returns a real `rate-limited` failure (quota flip observed on the real tool result via `wrapToolExecution`); **no** outbound HTTP occurs (zero expectations declared, and any attempt would trip the guard).                                                                                                                                                                                                                                      |

**Distillation is bypassed** for the success page. `distillWebContent` returns the content
verbatim as summary + excerpt when `content.length <= MAX_EXCERPT_CHARS` (8000)
(`distill.ts:180-181`), so `SCN-web-fetch` makes **no** proactive-LLM call and declares **no**
`world.http.expect` chat route — a genuine simplification versus F3/F5 fire scenarios. The
served page is kept small deliberately (Deliberate exclusions).

**Mode footnote.** `SCN-web-fetch` is **story-mode-only**: the global-fetch patch that
intercepts the target URL is active under `bun test:stories`, not under `--contracts` (the
F5 fire / F4 transcript-viewer precedent). `SCN-web-fetch-rate-limit-deny` is **not**
story-mode-constrained — the quota gate throws before any fetch, so no HTTP interception is
involved.

## Reclassifications and findings (roadmap rule 6)

- **`SCN-web-fetch-rate-limit-deny` drops `public-url-assertion`.** Audited
  `needs:[capability-ids, public-url-assertion]` with "Quota deny is seedable via
  consumeWebFetchQuota; the URL assertion seam is needed for the attempt to reach the quota
  check." Research corrected the mechanism: quota is enforced at `fetch-extract.ts:229`
  (`enforceQuota`) **before** `safeFetchContent` at line 235, so the deny path — pure schema
  validation → `normalizeWebUrl` (pure) → `enforceQuota` throws — never reaches
  `assertPublicUrl`. The scenario **stays executable** and needs only `capability-ids` plus
  the `given.exhaustedWebFetchQuota` seed. The corrected rationale is recorded on its
  executable mapping. This is a rationale fix (rule 6), not a family move.
- **`SCN-web-fetch` keeps `[capability-ids, public-url-assertion]`.** Accurate; carried
  forward on its executable mapping.
- **`public-url-assertion` is exhausted by F6.** It was the family's only remaining consumer
  after F3's `fetch-chat-link` reclassification (roadmap seam-drift table). After F6 lands, no
  pending scenario references it; the seam id stays in `STORY_SEAM_IDS` as realized.

## Deliberate exclusions

- **No clock seam.** The world's fixed clock suffices for the quota window (`windowStart`
  alignment) and the 15-minute `web_cache` TTL (`DEFAULT_TTL_MS`, `fetch-extract.ts:21`) —
  both success turns fall in the same window/TTL. Virtual-time injection stays deferred to
  tiering phase 5.
- **No LLM distill route.** The success page is < 8000 chars, so distillation is bypassed.
- **SSRF/redirect-block variants stay out.** The seam bypasses `assertPublicUrl`, so blocked
  private-host/redirect behavior is not story-testable here; it remains covered by
  `tests/web/safe-fetch.test.ts` unit tests. F6 tests the tool surface and quota gate, not the
  guard internals.
- **`startBackgroundServices` stays false** (`world.ts`); no timers. The quota deny drives the
  tool through the normal scenario turn; the success path drives the real fetch/extract/cache
  pipeline through the tool.

## New seam

None. `public-url-assertion` was already reserved in `STORY_SEAM_IDS` and is realized by F6.
`given.allowPublicUrl` and `given.exhaustedWebFetchQuota` are harness `given.*` methods (not
`STORY_SEAM_IDS` ids), following `given.publicBaseUrl` / `given.recurringTask`.

## Ledger updates (same PR, roadmap rule 5)

Two `AUDIT_RECORDS` entries move to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-21'`
(the corrected `SCN-web-fetch-rate-limit-deny` rationale recorded on its mapping). No new
`STORY_SEAM_IDS` id. Contract-test totals update to **128 ids / 97 executable / 31 pending**;
the pending readiness split becomes **1 executable-as-is / 8 needs-seam / 22 blocked**
(needs-seam drops by 2). The runner manifest totals line follows
(`story catalog: 97/128 executable; pending 31 (1 executable-as-is, 8 needs-seam, 22 blocked)`).

## Success criteria

- 2 new scenarios pass sandboxed (`bun test:stories`).
- Ledger: 97 executable / 31 pending; runner prints the updated totals line.
- Both production changes (the `web.fetch` capability entry; the `safe-fetch` module override)
  land first, are reviewed independently, and are each covered by the story that consumes them
  (`SCN-web-fetch` covers both; `SCN-web-fetch-rate-limit-deny` covers `web.fetch`).
- The `given.allowPublicUrl` and `given.exhaustedWebFetchQuota` harness seams land before any
  story and carry their own contract tests.
- `bun test:stories:contracts` (including the new seam contract tests), typecheck, lint, and
  `format:check` stay green.
- `bun test:stories:stress` once before merge — no flakes.
- The compat baseline is re-recorded only for the intended frozen-harness byte changes; the
  existing scenario set is otherwise untouched.

## Risks

1. **Actor-id match for the quota seed** — the seeded `web_rate_limit.actorId` must equal the
   id `web_fetch` computes (`actorUserId ?? storageContextId`). A plan-discovery step confirms
   it against `tests/tools/web-fetch.test.ts` before the story asserts the deny.
2. **Cache freshness across the two success turns** — the durable anchor relies on the
   `web_cache` row staying unexpired between turns; the fixed clock and 15-minute TTL make this
   safe, but a plan-discovery step confirms the second turn is served from cache (no second
   expectation consumed) rather than re-fetched.
3. **Token echo reliability** — if the scripted model does not reliably echo the fetched token
   in its reply, the assertion reads the real tool result directly (F5's
   `world.model.inspections()` fingerprint precedent) rather than the reply string.
4. **Module-override isolation** — `setAssertPublicUrlForTesting` is mutable module state; its
   contract test must prove the override is cleared in teardown so no scenario leaks a bypassed
   guard into another (the notify-token isolation precedent).
5. **Content-size threshold** — the success page must stay under `MAX_EXCERPT_CHARS` (8000) to
   keep distillation bypassed and avoid needing an LLM route; the fixture page is sized well
   under it.

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F1 command-surface and meta-tools story family

**Status:** approved

**Date:** 2026-07-19

## Context

The coverage-expansion roadmap (`2026-07-19-story-coverage-expansion-roadmap-design.md`)
sequences family F1 (`meta-*` + `cmd-*`) first because `plugin-core-separation` rewires
exactly what these scenarios observe: tool assembly and registration, progressive
disclosure, compaction, and the command surface. The executed catalog audit
(`docs/superpowers/plans/2026-07-19-story-catalog-audit.md`) classified 17 of the 19 F1
scenarios as executable candidates (13 `executable-as-is`, plus 4 `needs-seam`:
`meta-search-tools` needs `capability-ids`, `meta-expand-result` needs
`compaction-trigger`, and both stop scenarios need `mid-turn-run-control`). `SCN-cmd-nerv` and `SCN-cmd-announce` stay pending as blocked by
design.

Landing this family moves the ledger from 32 to 49 executable scenarios and gives every
seam the refactor touches in the command surface and tool disclosure/assembly path a
behavioral tripwire.

Research basis: command surface (`src/bot.ts:119-129`, `src/commands/*`), run-control
(`src/run-control/*`, `src/commands/stop.ts`), meta tools (`src/tools/disclosure/*`,
`src/tools/compaction/*`), capability registration (`src/tools/core-capabilities.ts`,
`src/llm-orchestrator-tools.ts:222`), and harness mechanics
(`tests/stories/harness/scripted-llm.ts`, `world.ts`, `chat.ts`).

## Production seam: capability registration for meta tools

`registerOfferedCoreToolCapabilities` runs at `src/llm-orchestrator-tools.ts:222` against
the gated, pre-disclosure tool set, so disclosure-injected tools (`search_tools`,
`load_tool`) are invisible to it. F1 adds only what the stories need:

- `meta.expand-result` → `expand_result` as a new entry in `CORE_TOOL_CAPABILITIES`
  (`src/tools/core-capabilities.ts`). This works through the existing mechanism because
  `expand_result` is present in the offered set at registration time (normal mode,
  `src/tools/provider-independent-tools-builder.ts:110-113`).
- `meta.search-tools` → `search_tools` via one explicit `catalog.register(...)` inside
  the disclosure injection path (`src/tools/disclosure/wire.ts` or
  `applyCompactionAndDisclosure`), executed only when disclosure actually injects the
  tool — so capability resolution correctly fails in contexts where `search_tools` is
  not advertised.

`load_tool` deliberately gets no capability id: the scripted model's `autoLoadTools`
path already exercises it without one (YAGNI).

## Harness seams

Three harness-only additions, each with contract tests in `tests/stories/harness/`.

### 1. Non-exact reply matcher

`then.replyTo(user).contains(substring)` joins the existing exact matchers. `/config`
and `/dashboard` replies embed random single-use codes, so exact equality is impossible
and asserting the code would bake a secret into the story. Stories assert static text
with `.equals` and link shapes with `.contains` — never the code itself.

### 2. Gated model decision

A third `ModelDecision` kind (e.g. `gateCall(capabilityId, input)`): the scripted model
returns a test-released deferred from `doGenerate` for that generation and exposes a
handle `{ reached: Promise<void>, release(): void }` to the scenario. Story shape,
verified against run-control mechanics:

1. `given.llm([gateCall(...), answer(...)])`; dispatch the work message without awaiting
   the full turn (the world needs a dispatch path that returns after enqueue — see
   "world support" below).
2. `await gate.reached` — the turn is deterministically inside `generateText`;
   `runRegistry.begin` has already run.
3. `when.message(user, ctx, '/stop')` — the real handler runs inline (commands bypass
   the queue in production and in the harness) and flips `stopRequested` (first press)
   or aborts the `AbortController` (second press).
4. `gate.release()` — graceful: the AI SDK `stopWhen` condition fires at the next step
   boundary and the orchestrator posts the winding-down summary; abort: the parked
   generation rejects, `RunAbortedError` maps to the forced summary.
5. `world.settle()` drains the turn; assertions run.

The gate interacts with the I/O guard's leak checks, so scenario teardown must release
an unreleased gate and fail the story. This seam doubles as the future
steering-interjection hook.

### 3. Compaction-handle placeholder and oversized-payload knob

Scripted tool-call input may contain the sentinel `'$compaction:latest'`, which the
scripted model replaces with the handle of the most recent `CompactedEnvelope` observed
in tool results. This avoids coupling stories to the internal `res_<hex>` counter.
The `MemoryTaskProvider` gains a knob (per-task flag or instance option) making one
task's serialized tool result exceed `COMPACTION_THRESHOLD_BYTES` (8 000).

## World support

`when.message` awaits the full turn today (synchronous-to-settle). The stop stories need
a dispatch that returns after enqueue — a `world.dispatchMessage(user, context, text)`
primitive (or equivalent) that performs the real dispatch without settling, leaving
`world.settle()` for the story's explicit synchronization point. This is harness-only
surface, used only by the stop stories.

## Story files

### `tests/stories/commands/surface.story.test.ts` (14 scenarios)

Every scenario dispatches through the real registered handlers via
`when.message(user, ctx, '/cmd …')`. Replies are asserted exactly except where noted.

| Scenario                     | Shape                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-cmd-help`               | DM user gets the user help text; bot admin gets the admin appendix                                                               |
| `SCN-cmd-start`              | Welcome text; unauthorized user gets the refusal                                                                                 |
| `SCN-cmd-config-dm`          | DM issues a link — `.contains` shape assertion, never the code; non-admin DM path                                                |
| `SCN-cmd-config-group`       | Group admin gets the group redirect; non-admin member gets the admin-only message                                                |
| `SCN-cmd-context`            | Context report text                                                                                                              |
| `SCN-cmd-clear-self`         | Seed a turn, `/clear`, exact reply; the next turn's prompt fingerprint proves history is gone                                    |
| `SCN-cmd-clear-target-user`  | Bot admin clears another user; non-super-admin targeting an unauthorized user is refused                                         |
| `SCN-cmd-clear-all`          | Super-admin `/clear all` clears all users                                                                                        |
| `SCN-cmd-clear-group-denied` | Group non-admin gets the group-admin refusal                                                                                     |
| `SCN-cmd-dashboard`          | DM bot-admin with `DEBUG_SERVER` unset gets the deterministic disabled reply; group context gets the DM-only refusal             |
| `SCN-cmd-stop-noop`          | `/stop` with nothing running returns the no-op reply                                                                             |
| `SCN-cmd-stop-graceful`      | Gated decision: dispatch work → `gate.reached` → `/stop` → `release`; exact winding-down reply plus graceful stop summary posted |
| `SCN-cmd-stop-abort`         | Gated decision: `/stop` twice (graceful, then immediate); forced summary with completed-effects accounting                       |
| `SCN-cmd-acp`                | Dedicated story: eligible context gets the static ACP text; disabled context gets the plugin-disabled refusal                    |

`SCN-cmd-acp` resolution (deferred to this spec by the audit): a **dedicated story**, not
a second mapping of the integrations command story. The ledger asserts story-reference
uniqueness, and the two stories test different things — this one the command surface
(static text and disabled-context refusal), the integrations one extension registration
semantics.

### `tests/stories/meta/disclosure-and-compaction.story.test.ts` (3 scenarios)

| Scenario                 | Shape                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-meta-search-tools`  | Scripted `callCapability('meta.search-tools', { query })` returns the real lexical ranking; capability resolution itself proves the production registration seam                                     |
| `SCN-meta-load-tool`     | Script calls a non-advertised capability tool; `world.model.inspections()` proves `load_tool` ran first, then the real call                                                                          |
| `SCN-meta-expand-result` | Oversized memory-provider task → `list_tasks` arrives compacted (envelope asserted) → scripted `expand_result` with `'$compaction:latest'` → paged chunks match the seeded payload → reply quotes it |

## Deliberate exclusions

- No `debugEnabled` world option. `cmd-dashboard` covers the deterministic disabled-path
  reply (`DEBUG_SERVER` is env-read at handler time and the I/O guard forbids env
  mutation); the enabled claim-link path belongs to F4's dashboard-auth fixture. The
  audit rationale for `SCN-cmd-dashboard` is updated to say so.
- No menu/registration semantics — those stay with platform-adapter contract tests.
- `/stop` ownership semantics are tested as-is: any authorized member may stop a group
  thread's run (documented behavior, `src/commands/stop.ts`).
- `SCN-cmd-nerv` / `SCN-cmd-announce` stay pending (blocked).

## Ledger updates (same PR, roadmap rule 5)

Seventeen `AUDIT_RECORDS` entries move from pending to `EXECUTABLE_STORY_MAPPINGS` with
`verifiedAt: '2026-07-19'`, including the updated `SCN-cmd-dashboard` rationale and the
`SCN-cmd-acp` resolution note. Contract-test totals update to 128 ids / 49 executable /
79 pending with the recomputed readiness tally; the runner totals line follows.

## Risks

1. **Gate/leak-check interaction** — mitigated by teardown release-and-fail.
2. **Stop-summary determinism** — the story seeds a simple one-tool turn so
   `completedEffects` and the summary text are deterministic; the summary wording is
   asserted exactly on purpose (behavioral contract).
3. **Disclosure stall fallback** — the search-tools story must complete within the
   stall window (2 steps) or disclosure latches open; the scripted sequence is short
   enough by construction, and the contract test pins it.

## Success criteria

- 17 new scenarios pass sandboxed (`bun test:stories`: 40 → 57).
- Ledger: 49 executable / 79 pending; runner prints the updated totals line.
- The two production registration changes are one line each and covered by the
  meta-search-tools and expand-result stories.
- `bun test:stories:contracts`, typecheck, and lint stay green; the compat baseline is
  re-recorded after landing.

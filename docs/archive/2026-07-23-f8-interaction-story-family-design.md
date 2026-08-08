<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F8 interaction story family (terminal)

**Status:** approved

**Date:** 2026-07-23

## Context

The coverage-expansion roadmap (`2026-07-19-story-coverage-expansion-roadmap-design.md`)
sequences family F8 (`interaction-*`) last, after F1–F7. It is the **terminal family**: the
program document's queue ends here. F8's charter is "Interaction routing, permission prompts",
and its seam inventory in the Deliverable-2 table is explicit that only one of its four
scenarios is reachable today — "`interaction-permission-decision` is promotable today via
`when.interaction`; the other three stay forward-only unless the refactor touches chat
adapters" — with Dependencies/risks reinforcing that F8 "depends on nobody building platform
fakes speculatively; they are only justified if the refactor touches the chat adapters."

The catalog audit (`docs/superpowers/plans/2026-07-19-story-catalog-audit.md`) already promoted
`SCN-interaction-permission-decision` from forward-only to `ready` (the roadmap's sole current
`executable-as-is` pend) and classified the other three `needs-seam:[platform-adapter-fakes]`,
forward-only. F8 realizes that single promotion, sharpens the three parked records, and closes
the program.

The architectural fact that shapes the whole family: the hermetic harness enters at
`runtime.dispatchInteraction(...)` (`src/runtime/create-runtime.ts:194`), which sits **below**
the platform adapter. `SCN-interaction-permission-decision` lives at that dispatch layer and is
already exercised end-to-end — the `perm:a:`/`perm:d:` callback roundtrip runs today inside
`SCN-task-ask-confirm` (`tests/stories/tasks/lifecycle-and-policy.story.test.ts:237-254`). The
other three scenarios test the discord.js/grammY **wire above** that entry point, the layer the
harness deliberately bypasses; reaching them needs platform-adapter fakes and belongs to Tier-3
platform-integrated tests, explicitly out of the roadmap's scope.

Consequently F8 is a small, **zero-production-change** family (the F4 precedent): it lands one
executable scenario, parks three with sharpened rationale, and appends the roadmap's terminal
amendment.

Research basis: the coverage ledger (`tests/stories/catalog/coverage.ts:185-234,822-870`), the
existing interaction roundtrip and its callback helper
(`tests/stories/tasks/lifecycle-and-policy.story.test.ts:33-55,225-255`), the interaction seam
(`tests/stories/harness/scenario.ts:243,796-801`), the scenario chat provider's captured
finalization events (`tests/stories/harness/chat.ts:157-207`), the reply-assertion surface
(`scenario.ts:285-286,426-445,887-891`), the production dispatch surface
(`src/runtime/create-runtime.ts:194-196`, `src/runtime/types.ts:35,42`), the ADR-0182/0189
permission-prompt finalization UX (self-removing `ephemeralConfirm` + `PromptHandle.remove` +
`formatDecisionConfirmation`), and the landed F5/F6/F7 ledger deltas from their specs.

## Scope and scenario mapping

The four F8 records split cleanly by whether the behavior lives at or above the harness's
dispatch entry point:

| Scenario                                      | Layer                               | Disposition                                      |
| --------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `SCN-interaction-permission-decision`         | at `dispatchInteraction` (Tier 0)   | **promoted to executable** (new dedicated story) |
| `SCN-interaction-discord-router-wrapped`      | discord.js wire (above entry point) | stays **forward-only**, rationale sharpened      |
| `SCN-interaction-discord-standalone-fallback` | discord.js wire (above entry point) | stays **forward-only**, rationale sharpened      |
| `SCN-interaction-telegram-callback`           | grammY wire (above entry point)     | stays **forward-only**, rationale sharpened      |

## The one promotion — `SCN-interaction-permission-decision`

**Subject: the interaction router, not task policy.** The scenario runs the full ask-gate
callback roundtrip over a proven, hermetic ask-gated tool (task-create), but its distinctive
checkpoint — the one `SCN-task-ask-confirm` omits — is the **ADR-0182 finalization UX**: after
the callback is routed, the permission prompt self-finalizes (an `ephemeral-confirm` toast, a
`button-remove`, or a `button-redact`). This is precisely the interaction router's contract, and
it is a genuinely different behavioral proof from the task-policy story, which asserts only the
reply text and the durable task state and never observes prompt finalization.

Shape (both arms drive `when.interaction(user, context, callbackData)`, `scenario.ts:796`):

- An ask-gated tool call emits a prompt carrying `perm:a:`/`perm:d:` buttons.
- **Allow arm:** `when.interaction(perm:a:<id>)` → the deferred tool resumes and its durable
  effect is observable on the following turn (`then.task(...).exists()`), **and** the prompt is
  finalized (finalization event observed).
- **Deny arm:** `when.interaction(perm:d:<id>)` → the tool is refused, no durable effect
  (`then.task(...).absent()`), **and** the prompt is finalized.

The callback ids come from the existing `waitForPermissionCallback(world, 'perm:a:'|'perm:d:')`
helper pattern (`lifecycle-and-policy.story.test.ts:33-55`); the ask-gate is configured through
the real `tool_prefs` path (`given.toolPrefs(...)`), so the tool is incidental and the
interaction transport is the subject.

**Story file:** a new `tests/stories/interactions/` group (sibling to `tasks/`), e.g.
`permission-decision.story.test.ts`. Exact placement is a plan detail.

**No assertion-only story (rule 3).** The proof is observable behavior: a durable state change
gated behind the routed callback, plus the prompt-finalization payload — never a bare call count.

### Discovery step and named fallback (rule-2 / F7-style risk)

The finalization events are captured by the scenario chat provider (`chat.ts:161-188`), but no
story asserts the `ephemeral-confirm`/`button-*` kinds today, so the exact `then` surface is a
plan-discovery step: confirm `then.repliesTo(user)` (the `ReplyHistoryAssertion`,
`scenario.ts:441-445`) surfaces those kinds, or determine the equivalent observation via the
event trace. **Named fallback if finalization is not directly assertable:** prove the callback-id
**binding** instead — a mismatched or stale `perm:*` callback id leaves the prompt pending and the
tool deferred (no durable effect), which is still a distinct interaction-router proof and not a
task-story duplicate. The plan pins which observable ships before the story asserts.

## The three parked scenarios (sharpened rationale)

`SCN-interaction-discord-router-wrapped`, `SCN-interaction-discord-standalone-fallback`, and
`SCN-interaction-telegram-callback` stay **forward-only**. Their audit rationale is sharpened to
name the architectural boundary rather than only the missing fake: the hermetic harness enters at
`runtime.dispatchInteraction(...)`, below the platform adapter; these scenarios verify the
discord.js/grammY wire **above** that entry point (that a platform callback is decoded and routed
into `dispatchInteraction` at all), which is Tier-3 platform-integrated territory, explicitly out
of the roadmap's scope. `platform-adapter-fakes` remains the roadmap's single deliberately
unrealized seam, justified only if the refactor touches the chat adapters (it does not).

Building grammY/discord.js fakes now would directly violate the roadmap's Dependencies/risks
constraint; F8 does not build them.

## Production seam (none)

Zero production `src/` change, matching F4. The permission-decision dispatch path is already
production-complete and proven by `SCN-task-ask-confirm`; the promotion is a new story plus a
ledger update, nothing more.

## Harness seams (none new)

No new `STORY_SEAM_IDS` id and no new `given.*`/`when.*` seam. The story consumes the existing
`when.interaction` seam, the existing `given.toolPrefs` / `given.taskInstance` fixtures, and the
existing `then.replyTo`/`then.repliesTo`/`then.task` assertions. The only new file is the story
itself (and its `tests/stories/interactions/` group directory).

## Reclassifications and findings (roadmap rule 6)

- **`SCN-interaction-permission-decision` moves `ready` → executable.** Its `AUDIT_RECORDS`
  `ready('F8', …)` entry is removed and an `EXECUTABLE_STORY_MAPPINGS` entry is added with the
  implementation date as `verifiedAt`. This retires the roadmap's last `executable-as-is` pend.
- **The three wire-level records keep `needs-seam:[platform-adapter-fakes]`, forward-only**, with
  sharpened rationale (above). No status change; the reclassification is the rationale text, which
  now cites the dispatch-layer boundary explicitly.
- **`platform-adapter-fakes` is a deliberately unrealized seam.** After F8 it remains referenced by
  four pending records (`fetch-chat-link` from F3 and the three interaction records); it is not
  exhausted, by design, and each family PR named it as speculative-only. The fifth `needs-seam` pend,
  `http-mattermost-action` (F4), references the distinct sibling `mattermost-action-fixture` seam,
  also left unrealized.

## Roadmap closeout — terminal amendment

F8's PR appends an append-only **"Reclassifications and amendments (F5–F8)"** section to
`2026-07-19-story-coverage-expansion-roadmap-design.md`, mirroring the existing F1–F4 section, to
bring the program ledger current at the terminal family:

- **F5** `deferred-*`/`reminder-*` — 8 est → **8 executable**; realized the `scheduler-due-seed` /
  single-pass `tick`/`pollScheduledOnce`/`pollAlertsOnce` seams (no production clock seam); ledger
  87 → 95.
- **F6** `web-fetch` — 2 est → **2 executable**; realized the `assertPublicUrl` DI seam (the one
  small production change in the tail families) and DB-backed quota seeding; ledger 95 → 97;
  `public-url-assertion` exhausted.
- **F7** `settings-admin-mcp-*` + reclassified-in `http-mcp-plugin` — 2 est → **3 executable**;
  realized and exhausted `fake-mcp-server` across both MCP directions; one additive production
  change (user-MCP capability registration); ledger 97 → 100.
- **F8** `interaction-*` — 4 est → **1 executable + 3 forward-only**; zero production change;
  ledger 100 → 101; `platform-adapter-fakes` left deliberately unrealized.

The amendment extends the **seam-inventory drift** table (adding `assertPublicUrl` realized by F6,
`scheduler-due-seed` by F5, `fake-mcp-server` exhausted by F7, `platform-adapter-fakes` as the
single unrealized seam) and the **ledger trajectory** line (… → F4 87/41 → F5 95 → F6 97 → F7 100
→ **F8 101/27**), and marks the program complete: every one of the 128 catalog ids now carries an
executable mapping or a named, justified pend, with no generic "awaiting audit" reason remaining.

## Ledger updates (same PR, roadmap rule 5)

One `AUDIT_RECORDS` entry (`SCN-interaction-permission-decision`) moves to
`EXECUTABLE_STORY_MAPPINGS` with `verifiedAt` set to the implementation date. Contract-test totals
(`tests/stories/harness/catalog-coverage.test.ts`) update to **128 ids / 101 executable /
27 pending**; the pending readiness split becomes **0 executable-as-is / 5 needs-seam /
22 blocked** (`executable-as-is` drops to zero). The runner manifest totals line follows
(`story catalog: 101/128 executable; pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked)`).
The three parked records' rationale strings are rewritten in place (no count change).

## Deliberate exclusions

- **No `platform-adapter-fakes` seam** — grammY/discord.js fakes are speculative platform fakes the
  roadmap forbids absent a chat-adapter refactor; the three wire-level scenarios stay forward-only.
- **No new production code** — the dispatch path is already covered; F8 adds only a story and a
  ledger delta.
- **No new harness seam** — the story reuses `when.interaction` and existing fixtures/assertions.
- **Tier-3 platform-integrated wire tests stay out of scope** — decoding a real discord.js/grammY
  callback into `dispatchInteraction` is above the harness's entry point and belongs to the
  provider-real tier, not Tier 0.

## Success criteria

- 1 new scenario (`SCN-interaction-permission-decision`) passes sandboxed (`bun test:stories`),
  asserting a callback-routed durable effect **and** the prompt-finalization observable (or the
  named callback-binding fallback if the plan-discovery step so determines).
- Ledger: **101 executable / 27 pending** (0 executable-as-is); the runner prints the updated
  totals line.
- Zero production `src/` change; no new `STORY_SEAM_IDS` id; no new `given.*`/`when.*` seam.
- The three parked records read forward-only with rationale that names the dispatch-layer boundary.
- The roadmap doc gains the append-only F5–F8 amendment (rows, seam-drift table, ledger trajectory,
  program-complete note) in the same PR.
- `bun test:stories:contracts`, `bun test:stories`, typecheck, lint, and `format:check` stay green;
  `bun test:stories:stress` once before merge with no flakes.
- The compat baseline is re-recorded only for the intended frozen-harness byte change (the new
  story file under the frozen `tests/stories/**` tree); the existing scenario set is otherwise
  untouched.

## Risks

1. **Finalization observability.** The `ephemeral-confirm`/`button-*` kinds are captured but never
   yet asserted by a story. Mitigation: the plan-discovery step pins the exact `then` surface
   before the story asserts, with the callback-binding negative as a named fallback (see above).
2. **Non-duplication vs `SCN-task-ask-confirm`.** The two must prove different things. Mitigation:
   F8's checkpoints center on the interaction router's finalization/binding contract, not the tool
   effect; the frozen `then` metadata makes the distinction explicit.
3. **Frozen-tree discipline.** A new file under `tests/stories/**` re-baselines the compat manifest
   `treeHash`. Mitigation: the re-baseline is intended and recorded (rule 7); no runner/sandbox file
   changes.

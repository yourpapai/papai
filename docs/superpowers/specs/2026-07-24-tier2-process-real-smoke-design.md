<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Tier 2 process-real smoke lane

**Status:** proposed

**Date:** 2026-07-24

## Context

This is the second tier cycle under the tier expansion roadmap
(`2026-07-23-tier-expansion-roadmap-design.md`), which set the queue
T1 → T2 → T3 → T4 and mandated that each tier gets its own spec→plan cycle. T1
(the provider-real parity lane, plus its T1b `tests/e2e` retrofit) has landed:
the catalog now carries `@0` and `@1` records and the runner prints per-tier
totals.

T2's charter is the **process boundary**. Every tier at or below T1 runs
in-process: the story harness constructs a `PapaiRuntime` from fakes
(`world.ts`) and drives it directly, so nothing proves the *built artifact*
actually boots and serves. T2 closes that gap by running the real shipped
process — a Docker container built from the production `Dockerfile` — and
asserting its behavior entirely from the outside (HTTP status, container logs,
exit codes).

The roadmap's T2 row names the behaviors to prove: the built artifact boots,
migrations apply from an empty DB, required-env validation fails correctly,
plugin discovery and lifecycle run in the real process, the
settings/debug/admin/mcp surfaces bind, graceful shutdown drains — plus exactly
one full chat turn through the real process. It budgets ~6–10 minted `@2` ids
and declares the lane a **PR gate with a hard cap**. It also names the pre-work:
an out-of-process deterministic OpenAI-compatible LLM server (T3 later reuses
it), a minimal controllable ingress, and a reusable container image.

Recon of the current tree (all paths on master `2a60d7e63`) grounds the design:

- **Entry and shutdown.** `src/index.ts` reads `ADMIN_USER_ID` (the only env var
  that hard-exits at the shell layer: blank → `"Missing required environment
  variables"` + `exit(1)`), builds the production runtime, and registers
  SIGTERM/SIGINT handlers that call `runtime.stop()` then `exit(0)`.
- **Web surface.** A single `Bun.serve` (`src/debug/server.ts`) routes every
  surface. `GET /settings` returns the static SPA shell with `200`
  unconditionally, dispatched *before* any auth gate — the cheapest readiness
  probe. Protected routes return a served `401` when unauthenticated;
  debug-only paths return `404` unless `DEBUG_SERVER=true`. There is **no**
  `/health` endpoint.
- **Chat ingress.** Only four platform providers exist; Mattermost is the
  lightest to fake — its config takes an arbitrary base URL, and the provider
  does `GET /api/v4/users/me` then opens a WS to `/api/v4/websocket` expecting a
  `hello` then `posted` events. Pointing `MATTERMOST_URL` at a fake server
  drives the real `MattermostChatProvider` with zero production change.
- **LLM wiring.** The client is `@ai-sdk/openai-compatible` built from
  `LLM_BASE_URL` + `LLM_API_KEY` + `MAIN_MODEL`; any OpenAI-compatible server at
  that base URL is sufficient — a fake LLM is "just another base URL."
- **In-process tools.** The memory tools (`list_memory`, `remember_memory`) are
  backed purely by local SQLite, require no task provider, and are
  default-allowed for the bootstrapped admin. Progressive disclosure restricts
  the first model step to `{get_current_time, search_tools, load_tool}`, so a
  memory-tool turn must be scripted as two steps (`load_tool` → `list_memory`).
- **Image and infra.** The `Dockerfile` is multi-stage `oven/bun:1-alpine`; no
  `papai:e2e` image is built anywhere today — building and tagging it is new
  work. The `tests/e2e` lane's `docker-lifecycle.ts` is the container-lifecycle
  pattern to reuse.

## Deliverable: the process-real smoke lane

This lane packages as **one combined spec/plan/PR** (roadmap rule 1 permits, and
this cycle chooses, to keep the pre-work and the scenarios together). The
scenarios exercise no task provider, so — unlike T1 — the lane needs **no Kaneo
container and no docker-compose**.

### Architecture and component inventory

T2 brings up exactly three processes — the real `papai:e2e` container plus two
host-run fakes — and asserts from outside.

1. **`papai:e2e` image** (pre-work). Built from the existing multi-stage
   `Dockerfile`, tagged `papai:e2e`. CI already builds `papai:ci-build-<sha>` in
   the `build` job; the lane tags/loads `papai:e2e`. Local runs build-if-absent.
2. **Container lifecycle harness** (test infra). Mirrors
   `tests/e2e/docker-lifecycle.ts`: `docker run -d` with per-scenario env, poll
   readiness, assert, teardown via `docker rm -f`; idempotent. The container
   reaches the host fakes via `host.docker.internal` (`LLM_BASE_URL` and
   `MATTERMOST_URL` point there).
3. **Readiness probe.** No `/health` exists; the probe is `GET /settings` →
   `200`, served unconditionally before any auth gate. Earliest cheap signal
   that `Bun.serve` is bound and routing; it also grounds the boot+migrate+serve
   scenario.
4. **Deterministic OpenAI-compatible fake LLM server** (pre-work; T3 reuses). A
   minimal HTTP server the container talks to via `LLM_BASE_URL`, scripting
   responses per scenario. Because the real client treats it as just another
   base URL, no production wiring changes. This is the roadmap's shared
   deterministic-LLM machinery that T3's spec must extend.
5. **Minimal fake Mattermost HTTP+WS server** (test infra). Serves
   `GET /api/v4/users/me`, accepts a WS at `/api/v4/websocket`, emits `hello`
   then one scripted `posted` event, and captures the bot's outbound reply. The
   real `MattermostChatProvider` drives it end to end. It sequences the `posted`
   event only *after* the `/users/me` + `hello` handshake completes (removing the
   WS-race flake on the no-retry gate); the reply is captured via an awaited
   bounded promise.
6. **`@2` catalog seam** (pre-work). Extend `LIVE_STORY_TIERS` to include `'2'`,
   add a T2 suite-root mapping, and mint the eight `@2` records in
   `CATALOG_SOURCE`, each recording its rationale. Moves the runner's `T2` total
   from 0 to 8.

**Invariant — zero production `src/` change.** The entire lane is test infra +
Docker + env redirection. The T4 clock seam remains the program's only planned
`src/` change.

### The `@2` scenario catalog

Eight scenarios, each a served or externally-observed behavior — none a bare
green boot (roadmap rule 3) — within the 6–10 budget.

| #   | `@2` id                     | Charter behavior                                     | Assertable signal                                                                                                                         |
| --- | --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `SCN-boot-serve-empty-db`   | boots + migrations from empty DB + route binding    | `GET /settings` → **200**                                                                                                                  |
| 2   | `SCN-required-env-admin`    | required-env validation fails correctly             | blank `ADMIN_USER_ID` → log `"Missing required environment variables"` + **exit 1**                                                        |
| 3   | `SCN-debug-surface-gated-off` | debug surface gated off by default                | `DEBUG_SERVER` unset → `GET /debug` → **404**                                                                                              |
| 4   | `SCN-debug-surface-gated-on` | flag flips the gate; surface binds                 | `DEBUG_SERVER=true` → `GET /debug` → **401** (the 404→401 delta vs #3 is the gating proof)                                                 |
| 5   | `SCN-protected-surfaces-bind` | admin/mcp/protected surfaces bind + serve         | unauth `GET /mcp/status`, `/admin/identity/mappings`, `/recurring` each → served **401**                                                   |
| 6   | `SCN-plugin-registry-served` | plugin discovery + lifecycle in the real process   | authenticated `GET /settings/api/plugins` returns the shipped plugin set                                                                   |
| 7   | `SCN-chat-turn-tool-loop`   | exactly one full chat turn through the real process | fake MM delivers a message → real orchestrator runs `load_tool(list_memory)` → `list_memory` (local SQLite) → bot posts a captured reply   |
| 8   | `SCN-graceful-shutdown`     | graceful shutdown drains                            | SIGTERM → log `"SIGTERM received, starting graceful shutdown..."` + **exit 0**                                                             |

Notes:

- **#7 is the heart of the tier.** The fake LLM scripts a two-step turn — step 0
  `load_tool({names:['list_memory']})` (a step-0 meta-tool), step 1
  `list_memory` — because progressive disclosure restricts step 0 to
  `{get_current_time, search_tools, load_tool}`. `list_memory` is pure local
  SQLite (no network, no embedding side-effects), so the turn is fully
  container-hermetic. It exercises the real disclosure loop, the real tool-step
  boundary, and real tool execution.
- **#3/#4 are a deliberate pair.** One scenario cannot prove a *gate* — both
  states are needed. This makes the roadmap's "surfaces bind" behavior
  non-assertion-only.
- **#6 uses the served registry, not a log line.** Plugin discovery has no clean
  *unauthenticated* served surface. The design rejects the weaker
  `'Plugin activation complete'` log-grep in favor of a genuine served behavior:
  the harness mints a settings session (single-use claim flow), then
  `GET /settings/api/plugins` returns the shipped plugin set (`acp`,
  `audio-transcribe`, `synthetic-web-search`, `task-provider-kaneo`,
  `task-provider-youtrack`) with `{active, enabled, eligibility}`. The
  settings-session helper is reusable machinery. This honors rule 3's preference
  for a served behavior over an internal assertion.

### Container-reuse strategy (the budget driver)

With no Kaneo bring-up (T1's dominant ~37s cost is gone), the dominant cost is
container boot + the ~70 migrations. The eight scenarios need only **three**
container boots:

- **Container P** (valid env, `DEBUG_SERVER` unset, fakes wired): scenarios
  **1, 3, 5, 6, 7** run against one boot; scenario **8** is P's teardown
  assertion (SIGTERM it, assert the drain log + exit 0).
- **Container D** (`DEBUG_SERVER=true`): scenario **4** only.
- **Container E** (blank `ADMIN_USER_ID`): scenario **2** — exits `1`
  immediately, no full boot.

Two full boots plus one fast-fail.

### Frozen-tree placement (Rule 6)

Unlike T1's parity lane — which had to put its shared expectation module *inside*
the frozen `tests/stories/` tree because Tier 0 stories consume it — T2 shares
nothing with Tier 0 execution. All T2 harness and scenario code lives **outside**
the frozen tree, alongside the existing candidate-side Docker lane (e.g.
`tests/e2e/tier2/`). The **only** frozen-tree change is metadata: the eight `@2`
records in the catalog plus the `'2'` entry in `LIVE_STORY_TIERS` and the T2
suite-root mapping. That moves the `treeHash` once — the same argued, recorded
exception the tier-aware-ledger and T1 cycles established (rules 6/7). No Tier 0
executable behavior changes; 0Q byte-identity for every story file is untouched.

## CI and budget

- T2 is a **PR gate with a hard cap** (roadmap rule 5). A new gate job builds and
  loads `papai:e2e`, starts the two host-run fakes, runs the lane, and tears
  down. The wall-clock ceiling is **measured during implementation, not guessed**;
  the plan states it and a `timeout-minutes` guard enforces it, as T1's `e2e` job
  now does. A lane that exceeds its ceiling moves to nightly rather than slowing
  the inner loop.
- **No retries** (rule 4). The one real flake risk is the WS handshake; the fake
  Mattermost server neutralizes it by sequencing the `posted` event only after
  `/users/me` + `hello`, with a bounded awaited reply capture. If any scenario
  still cannot hold green, it is quarantined to nightly in the same PR with a
  ledger note — never retried.
- **Docker-gated, no silent pass.** T2 has no hermetic half (the whole tier is
  process-real), so with Docker unavailable the lane skips with a clear message,
  never silently green. On the PR gate, CI provides Docker.

## Implementation sequence

The combined plan sequences dependencies bottom-up so scenarios land only once
their machinery exists:

1. **`papai:e2e` image build + CI wiring** — the artifact under test.
2. **Deterministic fake LLM server** — reusable, T3-shared machinery.
3. **Fake Mattermost HTTP+WS server** — minimal ingress stub with handshake
   sequencing.
4. **Container lifecycle harness** — reusing the `docker-lifecycle.ts` pattern.
5. **The eight scenario tests** — in the T2 suite dir, using the harness + fakes.
6. **`@2` catalog seam** — `LIVE_STORY_TIERS` gains `'2'`, the T2 suite-root
   mapping, and the eight `@2` records mapped to the scenario files (the single
   frozen-tree metadata commit, rule 7).
7. **CI gate job** — budget measurement + `timeout-minutes` guard.

## Success metrics

- Eight `@2` `SCN-*` records in the catalog, each with a rationale; the runner's
  `T2` total moves 0 → 8.
- The real `papai:e2e` process boots from an empty DB and every one of the eight
  behaviors is asserted **externally** (HTTP status / logs / exit codes).
- **Zero production `src/` diff** in the PR.
- The measured PR-gate wall-clock stays inside the declared ceiling; the
  `timeout-minutes` guard enforces it.
- The deterministic fake LLM server exists as reusable machinery T3 will extend.
- The `treeHash` change is recorded with the PR as the intended, argued
  consequence of the `@2` catalog metadata.

## Out of scope

- Kaneo or any task-provider-real behavior (that is T1).
- Real platform *client* integration against fake servers (T3). T2's fake
  Mattermost is a minimal ingress stub to drive one turn — **not** a T3
  platform-integration fake.
- Interactive callbacks, action-signing, and multi-message conversations (T3+).
- Virtual clock, schedulers, and restart recovery (T4).
- Any production `src/` change; extending 0Q beyond Tier 0.

## Dependencies and risks

| Risk                                                          | Mitigation                                                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| WS handshake race flakes the no-retry chat-turn gate          | The fake Mattermost server sequences `posted` only after `/users/me` + `hello`, with a bounded awaited reply capture               |
| Docker flake reaches every PR once T2 gates                   | Rule 4 quarantine plus the rule 5 measured budget; the whole lane is Docker-gated and skips with a clear message when Docker is down |
| `host.docker.internal` is not reachable from the container on Linux CI | `docker run` likely needs `--add-host=host.docker.internal:host-gateway`; the plan resolves the exact flag                |
| The fake LLM/Mattermost servers drift from the real wire contracts | Keep them minimal and pinned to the exact endpoints the real clients call (recon-documented), so they cannot pass a wrong contract |
| The `@2` catalog metadata destabilizes the compat-critical catalog | It is the sole frozen-tree change; the `treeHash` move is recorded with the PR as an argued exception, as the ledger cycle established |
| T2 and T3 fork two overlapping ingress fakes                  | This cycle builds the shared deterministic-LLM server; T3's spec must extend it and say so in its deviations section               |

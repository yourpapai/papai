<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0332: Tier 2 Process-Real Smoke Lane — Dockerized Artifact Boot with Host Fakes, Eight `@2` Catalog Records

## Status

Accepted

## Date

2026-07-24

## Context

The tier-aware scenario catalog ledger (ADR-0324) and its Tier 1 / Tier 1b lanes (ADR-0325, ADR-0330, ADR-0331) proved provider-real behavior, but every executable record was still exercised **in-process** — the shipped `papai` artifact itself (the production `Dockerfile` image) had never been booted under test. Startup-env validation, DB migration from an empty database, surface gating (`/debug`, `/mcp/*`, `/admin/*`, `/recurring`), the authenticated settings plugin registry, a full chat turn through the disclosure tool loop, and graceful SIGTERM shutdown were all unverified at the process boundary. The tier-expansion roadmap defines Tier 2 as **process-real**: the real container, asserted entirely from outside, with its chat and LLM dependencies replaced by deterministic host fakes.

Ledger truth before this decision: 157 total scenario ids, 130 executable (101 `@0` + 29 `@1`), 27 pending, `LIVE_STORY_TIERS` frozen at `['0', '1']`.

## Decision Drivers

- **Zero production `src/` change.** The entire lane is test infrastructure + Docker + env redirection. If any task appears to need a `src/` edit, that is a stop-and-escalate signal, not a prompt to edit.
- **Asserted from outside the container only.** The artifact is a black box: assertions read HTTP status codes, container logs, and exit codes — no in-process hooks.
- **Deterministic host fakes, never live services.** An OpenAI-compatible fake LLM server (scripted FIFO responses, JSON-encoded tool-call arguments per the wire contract) and a minimal fake Mattermost HTTP+WS server (handshake-sequenced `posted` events, bounded outbound-post capture) run on the host; the container reaches them via `host.docker.internal`.
- **Container reuse for wall-clock.** Eight scenarios need only three boots: P (valid env, six scenarios), D (`DEBUG_SERVER=true`), E (blank `ADMIN_USER_ID`, foreground-to-exit).
- **No retries, measured budget (rules 4–5).** Docker-gated `describe.skipIf` skip — never a silent green; a scenario that cannot hold green is quarantined to nightly with a ledger note; the CI step ceiling is measured, then enforced with `timeout-minutes`.
- **Single frozen-tree change only.** The sole permitted `tests/stories/` change is catalog metadata: eight `@2` records plus `LIVE_STORY_TIERS` gaining `'2'`. All harness and scenario code lives outside the frozen tree under `tests/smoke/`, reusing the argued treeHash-move exception ADR-0324/ADR-0325 established.
- **Non-discovered scenario suffix.** `.smoke.ts` files fall outside the default `bun test` discovery pattern, so the Docker lane never runs in the default suite; it runs only via the explicit entry `bun test tests/smoke/run-smoke.ts` (the `test:smoke` script).

## Considered Options

### Option 1 — Host-run lane with real container + two host fakes (chosen)

A Bun-side harness wraps the `docker` CLI (build-if-absent `papai:e2e`, run/port/kill/rm), starts the two fakes with `Bun.serve` on ephemeral ports, boots the container with canonical env pointed at the fakes, probes `GET /settings` for readiness, and asserts eight behaviors across three boots. A candidate-side `SMOKE_STORIES` registry fixes the eight titles verbatim; a crosscheck test ties every frozen `@2` catalog record to a real `title('SCN-…')` invocation in the scenario bytes.

- **Pros:** tests the actual shipped artifact (migration, env validation, signal handling) that no in-process lane can reach; deterministic fakes give a no-retry PR gate; the fake LLM server is reusable for Tier 3; zero `src/` change keeps the blast radius at test infra.
- **Cons:** Docker wall-clock in the PR gate (mitigated by three-boot reuse and a measured `timeout-minutes` ceiling); lane requires Docker locally (mitigated by visible skip, never silent green).

### Option 2 — Extend the existing Tier 1 Kaneo Docker harness to boot papai (rejected)

Reuse the `tests/e2e` Kaneo container lifecycle to also start a papai container against a real Kaneo instance.

- **Pros:** reuses proven lifecycle code.
- **Cons:** couples the smoke lane to a live task tracker (non-deterministic, slower, and outside the smoke scope); the T2 contract is boot/gate/chat-turn/shutdown — not task-tracker parity, which Tier 1 already owns.

### Option 3 — In-process boot assertions (rejected)

Boot the papai server in the test process and assert surfaces directly.

- **Pros:** no Docker, fast.
- **Cons:** cannot prove the shipped image builds, migrates an empty DB, reads required env, or drains on SIGTERM — precisely the process-boundary behaviors Tier 2 exists to verify; this is indistinguishable from Tier 0 coverage.

## Decision

Option 1, implemented as:

1. **Docker harness (`tests/smoke/harness/`).** `docker.ts` (pure arg-builders, port parser, `isDockerAvailable`), `image.ts` (build-if-absent `papai:e2e`), `container.ts` (canonical env builder, `/settings` readiness probe, SIGTERM-drain and foreground-to-exit lifecycles) — DI-friendly `RunDocker` seams, unit-tested without Docker.
2. **Deterministic fakes.** `fake-llm-server.ts` (scripted FIFO completions; tool-call `arguments` JSON-encoded strings) and `fake-mattermost-server.ts` (`/users/me` + WS `hello` handshake before any `posted` event, bounded awaited outbound-post capture).
3. **Three scenario files.** `container-p.smoke.ts` (boot+empty-DB migration, debug-gated-off 404, protected surfaces 401, authenticated plugin registry via the real `/config` link flow, full disclosure chat turn, SIGTERM-exit-0 as teardown), `container-d.smoke.ts` (debug-gated-on 401), `container-e.smoke.ts` (blank `ADMIN_USER_ID` → exit 1 with the missing-required-env log).
4. **Registry + aggregator.** `scenarios/catalog.ts` (`SMOKE_STORIES`, byte-stable ids) and `run-smoke.ts` + the `test:smoke` script; the `.smoke.ts` suffix keeps the lane out of default discovery.
5. **Catalog seam (sole frozen-tree change).** `LIVE_STORY_TIERS` gains `'2'`; eight executable records minted with `provingTier: '2'` and story ids byte-identical to `SMOKE_STORY_IDS`; harness/totals count assertions updated in the same change (165 total / 138 executable / T2 8).
6. **Crosscheck + CI gate.** `catalog-crosscheck.test.ts` proves each `@2` record maps to a real scenario invocation; a `smoke` job in `.github/workflows/ci.yml` builds `papai:e2e` and runs the lane under a measured `timeout-minutes` ceiling.

## Rationale

- Process-real is the only lane that can falsifiably claim "the shipped artifact boots and behaves" — anything in-process re-tests Tier 0 with extra steps.
- Scripted FIFO fakes remove the non-determinism that forces retries, satisfying the no-retry rule by construction; the Mattermost handshake sequencing kills the WS race on the no-retry gate.
- Container reuse (P/D/E) keeps the measured wall-clock inside the PR-gate budget while covering eight behaviors.
- The byte-identical `SMOKE_STORY_IDS` ↔ catalog story ids, plus the crosscheck reading scenario file bytes, make the eight `@2` minted records machine-tied to real invocations — the same ledger-honesty discipline as the `@1` parity-title crosscheck.

## Consequences

### Positive

- The shipped image's boot, empty-DB migration, env validation, surface gating, authenticated plugin registry, chat turn, and graceful shutdown are CI-verified as a PR gate.
- The catalog carries its first `@2` records (8); per-tier totals print a live T2 tally.
- The fake LLM server is T3-reusable machinery; the lane establishes the process-real template for future tiers.
- Zero production-code change; the default `bun test` suite is unaffected (`.smoke.ts` non-discovery).

### Negative

- The PR gate gains a Docker build + two full boots of wall-clock; the ceiling must be re-measured if the lane grows.
- The frozen-tree `treeHash` re-baselines once for the catalog metadata.
- Local runs without Docker see skips, not green — developers must read the skip warning correctly.

### Risks

- Fake wire-contract drift from the real OpenAI/Mattermost clients — mitigated by asserting the exact fields the providers consume and by the crosscheck tying records to invocations.
- Hung container or unreachable host fake — mitigated by readiness timeouts, the SIGTERM-drain deadline, and the job-level `timeout-minutes` backstop.

## Related Decisions

- ADR-0324: Tier-Aware Scenario Catalog Ledger — the tier vocabulary and treeHash-move exception this lane uses.
- ADR-0325: Tier 1 Provider-Real Parity Lane — the tier-lane template (frozen expectations + candidate binding + ledger mint + crosscheck) this lane extends to process-real.
- ADR-0330: Tier 1b E2E Parity Retrofit — the immediately preceding ledger extension.
- ADR-0282: Hermetic E2E Master Baseline — the Docker lifecycle patterns the container harness mirrors.

## References

- Plan: `docs/superpowers/plans/2026-07-24-tier2-process-real-smoke.md`
- Spec: `docs/superpowers/specs/2026-07-24-tier2-process-real-smoke-design.md`
- Code: `tests/smoke/`, `tests/stories/catalog/coverage.ts`, `.github/workflows/ci.yml` (`smoke` job), `package.json` (`test:smoke`)

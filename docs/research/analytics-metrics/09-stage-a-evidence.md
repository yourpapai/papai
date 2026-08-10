<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics Stage A evidence log

**Opened:** 2026-07-24
**Plan:** [`06-implementation-plan.md`](./06-implementation-plan.md) (Tasks 1–18)
**Execution wrapper:** [`../../superpowers/plans/2026-07-24-analytics-stage-a.md`](../../superpowers/plans/2026-07-24-analytics-stage-a.md)
**Execution design:** [`../../superpowers/specs/2026-07-24-analytics-stage-a-execution-design.md`](../../superpowers/specs/2026-07-24-analytics-stage-a-execution-design.md)
**Branch:** `claude/analytics-metrics-research-plan-0q1fqk` (one commit per task)

This log is the durable evidence of record for the Stage A exit gate: the
17-control privacy-contract matrix, per-task gate results and commit hashes,
the Stage A exit checklist, and (post-merge) the Stage B window log.

## Privacy-contract control matrix (03 §12)

Failure of a relevant control blocks pseudonymous collection/egress;
controls 1–9, 14–17 and the aggregate-specific parts of 15 also block
aggregate publication.

| # | Control | Status | Evidence (task / test / date) |
|---|---|---|---|
| 1 | Registry closure | green | tests/analytics/registry-closure.test.ts; 080198417; 2026-07-24 |
| 2 | Strict schema fuzz | green | strict envelope + rejection coverage in contracts/event-props-behavior tests (080198417); formal table-driven proof in tests/analytics/privacy-contract.test.ts row strict_schema_fuzz (1a3134b96); 2026-07-28 |
| 3 | C3 canaries | green | text/username/prompt/args/result/error/URL/hostname/filename/project/status/tag/RRULE/token/raw-ID canary scans over normalized JSON in tests/analytics/normalizer.test.ts (c4079feb8); 2026-07-24 |
| 4 | Identity matrix | green | frozen vectors + namespace/session/Discord/guest matrix (748a57bbf) + two-actor cached-descriptor/shared-pool attribution proof in tests/llm-orchestrator-tools.test.ts (1f68f3caf); 2026-07-25 |
| 5 | Raw-ID absence | green | raw-ID canary scans prove only purpose-keyed pseudonyms survive in canonical JSON (tests/analytics/normalizer.test.ts, c4079feb8); captured-egress proof: poisoned source facts + C3/raw-ID canaries never reach egress URL, headers, body, logs, receipt, or dead-letter state in tests/analytics/delivery/captured-sink.testing.test.ts (4a1ecab2a); 2026-07-27 |
| 6 | Semantic outcome | green | exactly-one terminal classification in tests/llm-orchestrator-tool-events.test.ts ('analytics terminal ordering') + tests/llm-orchestrator-tool-terminal.test.ts; SDK-success structured failure never maps to semantic success in tests/analytics/llm-tool-integration.test.ts (6d429b5c4); 2026-07-25 |
| 7 | Consent matrix | green | 38,880-cell exact-decision Cartesian matrix in tests/analytics/governance/eligibility.test.ts (ab504fd5e); live observer fail-closed wiring (c4079feb8); store/send/delete result coverage complete: delivery lane incl. external gates (4a1ecab2a), actor/admin settings surfaces with action purity (471ac40f7); formal proof in tests/analytics/privacy-contract.test.ts row consent_matrix (1a3134b96); 2026-07-28 |
| 8 | Withdrawal race | green | collection-ref races (deny-before-writer, writer-before-deny + delete pre-ack, retained key versions) in tests/analytics/collection-writer-race.test.ts (d22a81eca); delivery-grant races at enqueue/lease/send-start incl. per-grant send mutex vs deny in tests/analytics/withdrawal-race.test.ts (d994c6f7e); withdrawal one-transaction shape with in-tx cancel and no-acknowledge-until-settled in src/analytics/governance/subject-service.ts; 2026-07-26 |
| 9 | Outbox/sink | green | store parts: migration 074 restrictive sink/event FKs, nine-state closed ledger, single-enabled-sink partial unique index, independent minimal deletion receipts, enqueue/lease/send-start/recovery race proofs in tests/analytics/delivery/store.test.ts, capability gate incl. OpenPanel negative fixture in tests/analytics/delivery/sink.test.ts, write-only sink lifecycle in tests/analytics/delivery/sink-service.test.ts (9ac052ff0); transport parts: DNS-pinned HTTPS-only transport (SSRF/public-address gate in tests/analytics/delivery/http-policy.test.ts; redirect refusal, request-body cap, endpoint-mismatch refusal, one-way receipt hash in tests/analytics/delivery/pinned-transport.test.ts; response-cap enforcement at src/analytics/delivery/pinned-transport.ts:106 with truncation coverage parked — now a runbook external-lane gate) [attribution corrected 2026-07-29], gated delivery worker (kill switch, daily cap with next-UTC-day deferral, lease/send/classify with grant+generation rechecks, per-grant mutex, cutover-fence admission, ambiguous-never-retried + explicit reconcile) in tests/analytics/delivery/worker.test.ts + delivery-lifecycle/aggregate-delivery suites, captured-egress canary proof (4a1ecab2a); 2026-07-27 |
| 10 | Session fixtures | green | sessionization v1 boundary fixtures 29:59/30:00/30:00.001, out-of-order/midnight-UTC/two-actors-one-thread/sibling-thread/Discord-null-thread/command/proactive/bot-only-reply/zero-duration fixtures, child-inherit vs activity-extend semantics, and guests-produce-no-session-rows proof in tests/analytics/derive/sessionizer.test.ts + tests/analytics/sessionizer.test.ts (35693a333); 2026-07-26 |
| 11 | Cohort/censor fixtures | green | immature (<24h) attempts censored never abandoned, withdrawal/deletion right-censoring (deny → censored + censor-interval materialization, deleteCanonicalEventsForRef cascades derived rows, interval survives), clarification_abandoned deny-after-scan/before-insert and writer-before-deny races via inherited ref in tests/analytics/outcomes.test.ts; censor-interval table in migration 075 (35693a333); 2026-07-26 |
| 12 | Rephrase persistence audit | green | transient in-memory lifecycle (capture discards raw text at the boundary, 30-minute TTL, max 3 sets per conversation, eviction/expiry/shutdown coverage-loss accounting, withdrawal without loss) in tests/analytics/rephrase/*.test.ts + tests/analytics/rephrase-handoff.test.ts; post-auth canary never survives capture or derivation in tests/analytics/intent-persistence-audit.test.ts (dccf6cc73); 2026-07-26 |
| 13 | Classifier contract | green | sealed-corpus hybrid parity with the frozen PoC values (accuracy 0.991667, macro F1 0.995641, coverage 0.991667, unknown precision 0.909091) in tests/analytics/intent-classifier.test.ts; derived intent_classified envelope/props contract + deterministic intent-output:v1 ids + inherited-ref withdrawal in tests/analytics/intent-derivation.test.ts; no PoC/small-model import in the runtime module graph + latency budget in tests/analytics/intent-persistence-audit.test.ts (dccf6cc73); 2026-07-26 |
| 14 | Backfill/provenance/reconciliation | green | one controlled decision per durable row (aggregate_only/rejected with exact controlled reasons; current rows never canonical/pseudonym/`unknown`), HMAC source references, provenance rerun = zero changes, interrupt/resume identical decisions, rollback reverses only first-created deltas, durable equation `usage_rows = canonical + rejected + ineligible + aggregate_only` with zero unexplained delta on closed epochs, open/stale epochs → `unreconciled_restart_gap` (no numeric plug) in tests/analytics/backfill.test.ts + tests/analytics/reconciliation.test.ts; fixture CLI dry-run/apply/reconcile status=reconciled unexplained_delta=0, rerun applied=0 (ff0df9c24); 2026-07-26 |
| 15 | External thresholding | green | frozen one-way lattice (total + one-way children only; multi-dimension/app-version/drill-through off-lattice) with primary thresholds (actor cells ≥10 eligible actors; guest cells ≥10 turns AND ≥10 contexts; null contributor count suppressed; unreconciled_restart_gap never publishable) and complementary suppression (single suppressed child hides the smallest releasable sibling, then the revealing parent total), strict aggregate-release V1 envelope, deterministic content-hash releaseId + idempotent rebuild, disclosureScope/threshold persisted per cell in tests/analytics/delivery/release-suppression.test.ts + tests/analytics/delivery/aggregate-release.test.ts (4a1ecab2a); 2026-07-27 |
| 16 | DSAR/delete/rekey/snapshot | green | DSAR export + deletion workflow + encrypted target bundles (d994c6f7e); rekey workflow incl. shadow equation + retirement gating (193327d5b + 1cdb28106); curated snapshot publisher + fail-closed SnapshotConsumerCoordinator + five reviewed Metabase models (3361cd9fb + 026f5be3f); production cutover-fence admission complete across every mutable class: delivery worker (8de50e5c4), intent/derive/backfill/retention/censor (8b62caaad), reconcile (0934b6fc5), snapshot staging (3361cd9fb); 2026-07-28 |
| 17 | Performance/expiry clocks | green | monotonic TTFT/first-visible-feedback clocks with not-applicable/negative/implausible rejection in tests/analytics/performance-clocks.test.ts (6d429b5c4); one isUnexpired guard at every read/derive/export/snapshot/lease/send boundary incl. purge-disabled exact-deadline proof, startup purge barrier, earliest-deadline wake in tests/analytics/retention.test.ts + tests/analytics/derive/store.test.ts (d994c6f7e); 2026-07-26 |

## Per-task evidence log

| Task | Named gate result | typecheck/lint | Commit | Date |
|---|---|---|---|---|
| 1 — contracts/registry | 28 pass / 0 fail (contracts, registry-closure, event-props-behavior) | clean / clean (knip clean) | 080198417 | 2026-07-24 |
| 2 — storage + mig 070 | 37 pass / 0 fail (070 migration, registration, storage) | clean / clean (knip clean) | aba0fd10c | 2026-07-24 |
| 3 — identity keys | 49 pass / 0 fail (keyring, install-id, pseudonym, scope) | clean / clean (knip clean) | 748a57bbf | 2026-07-24 |
| 4 — governance/eligibility | 73 pass / 0 fail (071 migration, stores, 38,880-cell matrix) | clean / clean (knip clean) | ab504fd5e | 2026-07-24 |
| 5 — normalizer/runtime | 97 pass / 0 fail (normalizer, aggregate, runtime, process-epoch, collection-writer-race, subscriber); feat c4079feb8 + fix d22a81eca | clean / clean (knip clean) | d22a81eca | 2026-07-24 |
| 6 — turn lifecycle instrumentation | 144 pass / 0 fail (bot, reply-tracking, steering, queue, guest-role, steering-step, production-deps-analytics, message-turn-integration) | clean / clean (knip clean) | a284dda66 | 2026-07-24 |
| 7 — llm/tool/perf instrumentation | 150 pass / 0 fail (orchestrator events/logging/tool-events, permission gate + prompt, live-status reporter, typing heartbeat, llm-tool integration, performance clocks, tool-slug generation, clarification) | clean / clean (knip clean) | 6d429b5c4 (+ knip 2a6d72ae5, fix f74047b35) | 2026-07-25 |
| 8 — provider/feature boundaries | 8A: 270 pass / 0 fail; 8B: 89 pass / 0 fail (analytics five + logging-privacy) + full regression 1756 pass; fix f3502ba5f (unconfigured producers, per-invocation opportunity, raw-URL log, MCP early-return) | clean / clean (knip clean) | 8A: 1f68f3caf; 8B: 0c8af4f0f + f3502ba5f | 2026-07-26 |
| 9 — delivery ledger | 68 pass / 0 fail (072 migration, registration, delivery-store, sink-gate, sink-lifecycle); fix 2a9b3126b (stuck-leased send-start) | clean / clean (knip clean) | 9ac052ff0 + 2a9b3126b | 2026-07-26 |
| 10 — intent + rephrase | 18 pass / 0 fail (intent-classifier, intent-derivation, rephrase, rephrase-handoff, intent-persistence-audit); affected suites 781 pass; gap-fix 3347cff30 (aggregate-local short-circuit + capture latency) | clean / clean (knip clean) | dccf6cc73 + 3347cff30 | 2026-07-26 |
| 11 — materializations | 60 pass / 0 fail (073 migration, registration, sessionizer, outcomes, feature-materialization, friction); mirrored derive/store/job suites 145 pass; tests/db + tests/analytics 1122 pass | clean / clean (knip clean) | 35693a333 | 2026-07-26 |
| 12 — backfill/reconcile | 30 pass / 0 fail (backfill, reconciliation); mirrored jobs suites + full tests/analytics 808 pass; fixture CLI dry-run/apply/reconcile status=reconciled unexplained_delta=0, rerun zero-change; fix 96d73c33d (fail-closed approval, HMAC high-water, ineligible writer) | clean / clean (knip clean, security 0 findings) | ff0df9c24 + 96d73c33d | 2026-07-26 |
| 13 — lifecycle/subject rights | 13A: 51 pass / 0 fail (retention, withdrawal-race, subject-export, deletion); fix d994c6f7e. 13B: 106 pass / 0 fail at task time (107 on 2026-07-29 re-verification; later tasks grew the aggregated suites) (rekey + cutover suites, all 14 checkpoints, abort matrix, shadow equation, interruption/resume at every subphase boundary, all 9 retirement refusals, 6-class delta survival [corrected from "10-class" 2026-07-29: MUTABLE_WRITER_CLASSES has 6 classes]) | clean / clean (knip clean) | 13A: abc702633 + d994c6f7e; 13B: 193327d5b + 1cdb28106 | 2026-07-26 |
| 14 — snapshot/metabase | 193 pass / 0 fail (snapshot, metabase-models, friction-sample, rekey, rekey-cutover aggregators); full tests/analytics 1110 pass; fix 026f5be3f (DAU/MAU + sessions metrics, strategy/coverage, in-admission generation resolution) | clean / clean (security 0 findings) | 3361cd9fb + 026f5be3f | 2026-07-27 |
| 15 — aggregate delivery | 48 pass / 0 fail (http-policy, aggregate-release, delivery-worker, captured-egress named gates); mirrored delivery suites + full tests/analytics 1206 pass; fix 8de50e5c4 (aggregate cutover-drain: two-table sendingInFlight, fence-free classify) | clean / clean (knip clean, format clean, security 0 findings) | 4a1ecab2a + 8de50e5c4 | 2026-07-27 |
| 16 — settings surfaces | server analytics suites 36 pass / 0 fail; test:client 1231 pass; stories 110 pass (incl. SCN-settings-admin-analytics); story contracts 354 pass; build:client clean | clean / clean (knip clean) | 471ac40f7 | 2026-07-27 |
| 17 — job registration | 32 pass / 0 fail (job-registration, runtime-lifecycle, event-bus, production-background); sweep 2204 pass; fix 0934b6fc5 (reconcile fence admission, epoch-bound overflow wiring, per-spec idempotence) | clean / clean (knip clean) | 8b62caaad + 0934b6fc5 | 2026-07-28 |
| 18 — docs/release gates | privacy-contract 19 pass / 0 fail (17-control table + synthetic captured-request sweep); rollout-gates 21 pass / 0 fail; binding sequence: build:client clean, tests/analytics+tests/settings 1334 pass / 0 fail, test:client 1231 pass, typecheck clean, lint clean, security 0 findings, test:stories:contracts 354 pass, test:stories 110 pass; `bun run test` (parallel) fails locally ONLY in review-loop suites (hard 5s timeouts under worker CPU contention; reproduced identically without Task 18 changes; 10474 pass / 0 fail serially, 244/244 standalone) — recorded as environmental, not a branch defect; test:e2e 66 pass / 0 fail (Docker Kaneo, test credentials); format/security:ci/knip/duplicates clean. Fixes: 1a3134b96 includes search-chat-history C3 log-key fix + E2E provider-scope harness fix | clean / clean (knip clean, format clean, security 0 findings) | 1a3134b96 | 2026-07-28 |

## Milestone rebases onto origin/master

| After task | Rebase commit | Date | Conflicts / resolution |
|---|---|---|---|
| 2 | rebased onto origin/master 0e5cfcc9e | 2026-07-24 | master added `069_alert_matched_task_ids`; analytics migration block renumbered to 070–073 per 06's own renumber rule (plan-sync commit follows) |
| 8 | rebased onto origin/master 998f394cc | 2026-07-26 | master's 76334f1f6 rewrote two test files; merged: kept master's suites + preserved our scope-free descriptor assertion (collaboration-tools-builder) and scope-passthrough tests (auto-provision, adapted to required 5th scope param) |
| 13 | rebased onto origin/master 9e6760773 | 2026-07-26 | master added `070_message_metadata_history_search` + `071_message_embeddings`; analytics block renumbered to 072–075 per 06's renumber rule; also merged master's bot caching refactor (cacheObservedIncomingMessage) with our bot split, and regenerated tool slugs for master's new tools |
| Stage B readiness | rebased onto origin/master be67c2227 | 2026-07-29 | master added message-edit handling (`src/message-edit/`, `onMessageEdit` wiring, `CoalescedItem.messageIds/segments`, `runRegistry.begin.originatingMessageIds`) + mutation coverage tooling; no new migrations or tools (no renumber/slug regen). Conflicts: bot.ts/message-queue/queue.ts/tests/bot.test.ts union-merged (edit fields + `analyticsTurnSeed`); our `llm-orchestrator-unconfigured.ts` kept over master's `llm-orchestrator-resolve-llm.ts` (strictly subsumed: same functions + analytics scope observation; master module + its suite deleted); master's `bot-coalesced-processing.ts` superseded by our `processQueuedTurn` (deleted, knip-clean); test fixtures updated for master's required fields; edit wiring kept in setupBot; integration commit 58c14c746. Edit-path analytics coverage analysis follows in its own section below |

## Stage A exit checklist

- [x] All 18 task commits recorded above with hashes
- [x] Control matrix all green (driven end-to-end by tests/analytics/privacy-contract.test.ts: 19 pass / 0 fail, 2026-07-28)
- [x] Synthetic complete process epoch reconciles to zero (attach output) — final reconciliation 2026-07-28, synthetic fixture DB (`/tmp/final-recon/recon.db`, one synthetic `llm_usage_events` row at/after the approval cutoff):
  `run=backfill-v1:llm_usage_events status=completed scanned=1 aggregate_only=1 applied=1`; rerun `applied=0 skipped=1`;
  `reconciliation status=reconciled unexplained_delta=0 gap_epochs=0 publishable_epochs=0 delivery_total=0`
  (zero unexplained source delta, zero epoch-association delta, zero delivery-state delta, zero privacy canary — synthetic values only; canary sweep in tests/analytics/privacy-contract.test.ts)
- [x] Snapshot byte verification result recorded — synthetic snapshot published + `verifySnapshotFile` green in the privacy-contract sweep (snapshot bytes scanned for C3/raw-ID canaries: zero matches); CLI `--verify` semantics verified in tests/analytics/jobs/snapshot.test.ts (gate 2)
- [x] Deletion drill output recorded — subject deletion workflow + encrypted target-bundle destruction suites green (tests/analytics/governance/subject-deletion.test.ts, deletion-target-store.test.ts; control 16, 2026-07-28)
- [x] Rekey drill output recorded — plan/apply/verify/abort + retirement-refusal + cutover suites green (tests/analytics/rekey.test.ts, rekey-cutover.test.ts; control 16, 2026-07-28)
- [x] Task 18 binding commands all pass, outputs attached (see Task 18 row above):
  `bun build:client`, `bun test tests/analytics tests/settings`,
  `bun test:client`, `bun run typecheck`, `bun run lint`, `bun security`,
  `bun run test` (local parallel-run environmental failure recorded; full suite
  green serially: 10474 pass / 0 fail), `bun test:stories:contracts`,
  `bun test:stories`, `bun run format:check`, `bun security:ci`, `bun run knip`,
  `bun run duplicates`; `bun test:e2e` 66 pass / 0 fail
- [x] Final whole-branch review (2026-07-28, base 9e6760773): verdict **With
  fixes** — three Important findings closed in `a4f7d821e` (live-lane
  normalization-rejection accounting wired to the bounded rejection store;
  derive partition writes made transactional; no-turn facts produce
  `turn_key = null` instead of a shared sentinel). All ~35 parked Minor
findings triaged: none block merge; deferred external-lane items captured
   in the runbook's new **Stage B entry checklist** (`resolveSinkForSend`
   egressMode matching, release-execution wiring, grantKey required-ness) —
   all three completed 2026-07-29 (6933360d6, af2eae8ec, c3f39ddd1; see the
   Stage B readiness table) and the checklist extended with four further
   external-lane gates. Post-fix gates: tests/analytics 1398 pass (1344
   pass / 0 fail on 2026-07-29 re-verification at HEAD), privacy-contract +
   rollout-gates green, typecheck/lint/knip clean.
- [x] Privacy/security owner signature on this evidence

**Privacy/security owner signature:** Dmitriy Lazarev  date: 2026-07-29

## Sign-off re-verification (2026-07-29)

Before signing, the owner re-ran the binding evidence at HEAD and
independently reproduced the drills; the corrections above were applied in
the same pass.

- Binding gates: `tests/analytics/privacy-contract.test.ts` +
  `tests/analytics/rollout-gates.test.ts` 39 pass / 0 fail; full
  `tests/analytics` 1344 pass / 0 fail (194 files); typecheck/lint/knip
  clean.
- Reconciliation drill reproduced fresh (new synthetic fixture DB, one
  `llm_usage_events` row at the approval cutoff): apply `aggregate_only=1
  applied=1` → rerun `applied=0 skipped=1` → reconciliation `reconciled
  unexplained_delta=0`; durable equation holds with zero unexplained delta.
- Deletion/rekey/withdrawal drill suites 143 pass / 0 fail (incl. encrypted
  target-bundle destruction, 14 checkpoints, abort matrix, shadow equation,
  9 retirement refusals); egress + thresholding suites 69 pass / 0 fail
  (captured-egress canary proof over URL/headers/body/logs/receipt/
  dead-letter; all release thresholds and complementary suppression).
- Whole-branch-review fix commit `a4f7d821e` verified against the diff: all
  three Important findings closed (live-lane rejection accounting wired to
  the bounded store, derive partition writes transactional, no-turn facts
  emit `turn_key = null`).
- Stage B readiness commits verified against diffs with 620 tests green;
  runbook external-lane gate extended with four items found parked but
  uncaptured (sink-version gate ordering, remote-deletion dedupe,
  response-cap receipt semantics, attestation-default-unchecked).

## Stage B window log (post-merge, operational)

- Deploy date / version: 2026-07-31 / 0368bcc1d67bd9d79ae95ac20663aa836a5f9063
- Window start (UTC): 2026-08-01
- Window end (UTC):
- Restart/suppressed days (`unreconciled_restart_gap`):

### Daily log (report CLI rows)

| Day (UTC) | Eligible | Reason | Freshness | Recon delta | Rejects | Overflow | Expiry | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-08-01 | true | — | none | 0 | 24 (invalid_value=24) | 0 | ok | — |
| 2026-08-02 | true | — | none | 0 | 0 | 0 | ok | — |
| 2026-08-03 | true | — | none | 0 | 2 (invalid_value=2) | 0 | ok | — |
| 2026-08-04 | true | — | none | 0 | 150 (invalid_value=150) | 0 | ok | — |
| 2026-08-05 | true | — | none | 0 | 96 (invalid_value=96) | 0 | ok | — |
| 2026-08-06 | true | — | none | 0 | 50 (invalid_value=50) | 0 | ok | — |
| 2026-08-07 | true | — | none | 0 | 98 (invalid_value=98) | 0 | ok | — |
| 2026-08-08 | true | — | none | 0 | 4 (invalid_value=4) | 0 | ok | — |
| 2026-08-09 | true | — | none | 0 | 26 (invalid_value=26) | 0 | ok | — |

| Week | Freshness | Reconciliation delta | Rejects | Overflow | Expiry check | Notes |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |

**Stage B exit review:** ____________________  date: ________

## Follow-ups parked during the build

- Task 1: `superRefine` in contracts emits a generic message instead of
  forwarding underlying Zod issues (Minor; triage at final whole-branch
  review).
- Task 1: third test file `tests/analytics/event-props-behavior.test.ts`
  exceeds 06's literal add list; accepted under the plan's line-limit split
  permission (split keeps every file ≤300 lines).
- Task 3 (parked Minors): pin one digest per purpose domain; install-id
  concurrency/malformed-stored-value handling; `buildPseudonym` null-swallow
  without log.
- Task 4 → **Task 13 review focus**: rekey abort/pause lifecycle semantics
  (plan-phase `aborted` permits new plan; post-dual-write failures are
  `paused` and resumable) need store-API + tests in the rekey-execution task.
- Task 4 → **Task 18 file list**: document `ANALYTICS_KILL_SWITCH` in
  `.env.example` and `docs/architecture/environment.md` (introduced in
  policy-store.ts by Task 4).
- Task 4 (parked Minors): `updatePolicy` check-then-act not atomic;
  generation advisory cache is DB-agnostic; `findStagedRow` full-table scan;
  rekey staging run validation outside its transaction (benign single-writer).
- Task 5 → **Task 7 review focus**: interim subscriber keys `sourceEventId`/
  `rawAttemptId` on turnId alone (multi-attempt turns dedup to first attempt
  per type — fail-closed drop, not a leak); subscriber hardcodes
  `providerBinding: 'unmapped'`, `modelRole: 'main'` pending real
  instrumentation.
- Task 5 → **Task 17 review focus**: UTC-day finalization driver ownership
  (built but unwired scheduler is Task 17 scope);
  `epoch-store.markOpenEpochsStaleOnStartup` retains an unused threshold
  variant — remove or reconcile; `onEpochRecovered` callback fires inside the
  recovery transaction (move post-commit or document).
- Task 5 (parked Minors): `resolveActive` reads via outer db handle inside
  the fenced tx (harmless on better-sqlite3 single connection).
- Task 6 (parked Minors): `turn_steered.steerLengthChars` records exact
  length while the plan text says "length bucket" — schema name is
  plan-mandated; final review confirms against 02. `buildAuthCheckedFact` and
  command-path reply analytics mint fresh UUIDs per fact instead of
  seed-anchored derivation (harmless; HMACed before storage).
- Task 7 → **Task 8 review focus**: production callers don't yet pass attempt
  fields — `providerBinding` stays `unmapped` and `emitLlmError` legacy paths
  default ordinal 0 (mismatch with started attempts N>0) until Task 8 wires
  the invoke/error boundaries; clarification signal feeding unwired (Task 8).
- Task 7 → **Task 13 note**: subscriber derives `toolNameKey` with the
  keyring active at `startAnalytics` time — after key rotation the normalizer
  could reject old-version name keys until restart (fail-closed, bounded).
- Task 7 (parked Minors): `decisionLatencyMs` includes prompt-send latency;
  permission resolve-before-send-settles can leave requested/resolved
  unbalanced; `wrapModelForTtft` throws on non-V4 models (new hard failure on
  a tolerant path); live-status update ordinals follow settle order.
- Task 7 → fixed during 8A: non-V4 TTFT regression in
  tests/run-control/invoke-wiring.test.ts (6 failures) fixed by tolerant
  pass-through (24344ae23).
- Task 8 split note: Task 8 executed as 8A (scope plumbing, commit 1f68f3caf)
  + 8B (boundary instrumentation, plan's exact commit message), deviation
  from one-commit-per-task recorded; 8A minors parked: non-executable
  descriptors dropped by finalize pass (matches legacy wrapToolSet),
  per-instance alert-poll attribution (first routable owner), dead
  `frame.lease === null` check.
- Task 8 (parked Minors): acp unconfigured guards emit before returning the
  error object (contract-equivalent ordering); `observeUnconfiguredTaskInstance`
  builds settings actor context even when observer is null (short-circuit
  opportunity); MCP `policy_blocked` enum intentionally unproduced — no
  connect-time policy gate exists (documented in
  src/mcp/connect-observation.ts; 06 plan text annotated).
- Known environmental failure (not a branch defect):
  tests/debug/settings/coding-credentials-models-route.test.ts fails locally
  because this machine's DNS resolves api.anthropic.com to a fake-ip
  (198.18.x.x) that `assertPublicUrl` blocks; expected green in CI. **Not
  observed during Task 18 (2026-07-28): the suite passed locally (4 pass / 0
  fail) and in the full serial run.**
- Task 18 (recorded, not fixed): `bun run test` (`bun test --parallel`) times
  out locally in ~15–27 review-loop suites (hard 5s timeouts under worker CPU
  contention on this machine; git-heavy fixtures). Reproduced identically with
  Task 18's changes removed, so it is not a branch defect; the affected suites
  pass standalone (244/244) and the full suite passes serially
  (`bun test:serial`: 10474 pass / 0 fail across 1197 files). CI runs the suite
  serially for exactly this reason (tests/CLAUDE.md).
- Task 18 (fixed in 1a3134b96): gate 7 exposed a real branch defect — master's
  `src/tools/search-chat-history.ts` logged the raw `query` metadata key (C3
  free text), failing the Task 8B logging-privacy static closure; the debug
  entry log now records `queryLengthChars` instead. `bun test:e2e` exposed a
  second latent defect — tests/e2e/global-setup.ts called
  `provisionAndConfigure` directly with no provider request scope (Task 8
  boundary made `provisionFetch` fail-closed); the harness now wraps the call
  in `runWithProviderRequestScope(NO_ANALYTICS_SCOPE, …)`, the designed
  bootstrap sentinel. E2E is green (66 pass / 0 fail) with test credentials.
- Task 18 (tooling wart, not fixed): `bun security`/`security:ci` leaves an
  untracked `semgrep-results.sarif` in the repo root that `bun run format:check`
  then flags; delete the artifact before the format gate.
- Task 9 (parked Minors): `markSendStarted` doesn't compare caller grant ref
  against the row's stored grant columns; `rotateSinkVersion` creates the
  successor before running the capability gate (orphaned pending row on
  denial); `disableSinkVersion` cannot retire a permanently-failed
  `pending_verification` version (plan-mandated transition set — revisit at
  plan level); `verifySinkVersion` enable not conditioned on still-pending
  state; defensive `sendStartedAtMs: null` in markSendStarted's lease_expired
  branch.
- Task 10 → **Task 13/16 review focus**: `withdrawFor` rephrase withdrawal is
  built and unit-tested but has no production callers until the preference
  withdrawal surfaces land.
- Task 11 → **Task 17 review focus**: `runDeriveJob` is a library function
  (window + 2-minute live watermark, `localMode` gate); scheduled registration
  must pass the current mode, like `runIntentDerivation`.
- Task 11 (parked Minors): censor intervals are discovered only while a denied
  ref still has event associations (deny-before-delete window); a deletion
  executed before any derive run leaves no censor-interval row. Outcome
  relevance is turn-level (any same-turn semantic success satisfies any goal of
  that turn); per-goal tool relevance needs intent.v2-era evidence.
- Task 10 → **Task 17 review focus**: `runIntentDerivation` now requires
  `localMode` and short-circuits outside `local_pseudonymous`
  (3347cff30) — the job scheduler must pass the current mode.
- Task 10 (parked Minors): persistence-audit sweep narrower than the brief's
  literal list (expire-then-rescan, captured-log scan, queue scan);
  no-SMALL_MODEL scan is regex over src/analytics specifiers, not a full
  module-graph walk, and doesn't assert small-model-status.json values.
- Task 8 → fixed during Task 10: ACP entry-graph containment regression
  (coding-session configure 4 failures) fixed by import.meta.require lazy
  loads (3601c2913). Gate lesson: tests/coding-sessions/ must be in
  plugin-touching gate lists.
- Task 11 → **Task 13/17 review focus**: censor intervals are discovered only
  while a denied ref retains associations — a deny+delete before any derive
  run leaves no interval row (accepted v1 limitation).
- Task 11 (parked Minors): `analytics_censor_intervals` kind `'deletion'` has
  no writer (deletion right-censors via FK cascade instead); outcome success
  relevance is turn-level not per-goal (documented v1 limitation — a goal
  whose tools failed can inherit a sibling goal's success);
  clarification_abandoned inserted mid-run reflects in session-events on the
  next run (eventual consistency); goal-less clarification treated as engaged
  by any follow-up (conservative); derived events stamped `source: 'live'`,
  `attribution_quality: 'native'` (consistent with Task 10 precedent — final
  review to confirm the contract reading).
- Task 12 (parked Minors): reconciliation counts usage rows ≤ boundMs while
  the scan bound is the finer (occurredAt, eventId) keyset — post-run rows at
  the same ms surface as delta until the next run (honestly reported,
  self-heals); `routeFutureCanonicalDecision` passes the outer db handle into
  insertEligibleCanonicalEvent inside the tx callback; hand-crafted fixture
  high-water keys still embed raw event IDs (fixtures only); arg parser's
  missing-value error reason slightly misleading; rollback mixes db/tx in the
  tx callback and relies on FK cascade for contribution-row removal;
  `reverseCounterContribution` JSON.parses the cell key (string-format
  coupling).
- Task 13 split note: Task 13 executed as 13A (lifecycle + subject rights,
  abc702633 + fix d994c6f7e) + 13B (rekey workflow), same deviation precedent
  as Task 8.
- Task 13A (parked Minors): `ClassifyDeliveryInput.grantKey` optional — a
  caller omitting it can wedge a grant at `send_in_progress` (make required);
  mutex acquisition keyed on caller-passed grant vs release on row grant
  (pair exactness); deletion rebuild commits as separate tx after settle —
  a crash between loses the rebuild set (persist affected days in the sealed
  bundle); `openDeletionTargets` throws raw GCM auth error instead of typed
  `DeletionIncompleteError`; delivery store at 299/300 lines (next addition
  forces a split); `deleteBackfillEventMapsForEvents` dead code; default
  invalidator's containment check is vacuous until Task 14's coordinator;
  aggregate rebuild downgrades assessed rollups (threshold → null) and resets
  quality columns — review at Task 14.
- Task 13B → **Task 17 review focus**: production mutable writers (intent
  scheduler, derive, backfill, retention, delivery worker) must call the
  cutover fence `admit`/`isFenceHeld` — currently only snapshot staging is
  durably blocked (fail-closed stubs pending).
- Task 13B → **Task 15 review focus**: the delivery worker (built in Task 15)
  must also admit to the cutover fence.
- Task 13B (parked Minors): per-subphase before-commit interruption fixtures
  absent (shared rollback primitive covers the mechanism); `releaseFence`
  dead API; verify-content test imports from sibling suite; censor intervals
  keep old-generation actor keys after retirement (deliberate audit choice);
  `remoteDeleteIn` can issue duplicate remote deletion calls for actors with
  multiple settled deliveries; CLI `apply` checks stored plan hash without
  recomputing against current DB state (delta catch-up by design).
- Task 14 (parked Minors): `--aggregate-only` CLI flag exceeds the literal
  "--output/--verify/--replace only" constraint (accepted as functionally
  needed); `verifySnapshotFile` runs after the rename into place under
  --replace; friction sampler ignores storage generation + expiry filters;
  `copyCensorIntervals` has no generation filter; no fixture asserts non-zero
  `tenure_unknown_actors` or the `missing_strategy` bucket; fence admission
  held for entire staging duration (intentional but blocks rekey drain —
  comment requested).
- Task 15 (parked Minors): `toAggregateRecord` hardcodes quality.source/
  reconciliation/late_event_count instead of carrying the rollup row's actual
  values; 64 KiB response-cap truncation branch untested (receipt hashes over
  truncated bodies); `resolveSinkForSend` never matches egressMode to the
  delivery lane (crossed sinkVersionId would misroute); `assessReleaseRequest`
  has no production caller yet (wire with the Task 16 release API); drain
  window is lease-bounded in both lanes (consistent).
- Task 16 (parked Minors): body-supplied actor IDs on export/withdraw/delete
  are ignored not rejected (query-param path rejects; inconsistent);
  action-purity assertion written only for preference-write + withdrawal, not
  export/delete; admin gate attestation checkboxes default to true
  (unchecked-by-default would match evidentiary intent); stories pass
  undeclared contextId/scope args (dead args); SCN-settings-admin-analytics
  has no coverage.ts entry (invisible to coverage counting).
- Task 17 (parked Minors): reconcile holds its fence admission across the
  whole run incl. the read phase (narrow to apply phase if drain latency
  matters); overflow binding hardcodes sourceFamily `chat` (skew only in
  per-family breakdowns; disposition accounting correct); dynamic next-expiry
  wake is computed but never re-points the scheduler (fixed 60s cadence
  satisfies the floor); snapshot handler throws on held fence while other
  jobs skip cleanly (error-hook noise hourly during cutover).
- Task 18 (parked Minors): screenshot leg of the canary sweep is conditional
  and was vacuous locally (no .storybook-shots/); `utcDayMs` in stage-gates
  returns NaN on malformed input; privacy-contract driver spawns nested bun
  test (~35s inside full parallel runs — consider a skip-fixtures escape
  hatch); mixed docs+code commit ratified by controller (.env.example
  plan-mandated, stage-gates.ts TDD-required, two defect fixes gate-blocking,
  all declared).
- Carry to whole-branch review: confirm `bun run test` (parallel mode) green
  in CI per the both-modes expectation in tests/CLAUDE.md:9 — locally green
  only serially (review-loop 5s timeouts under contention; not a branch
  defect, reproduced without the branch).

## Stage B readiness evidence (pre-merge fixes)

| Item | Gate result | Commit | Date |
|---|---|---|---|
| resolveSinkForSend egressMode matching | tests/analytics/delivery green (worker-send + worker crossed-lane) | 6933360d6 | 2026-07-29 |
| ClassifyDeliveryInput.grantKey required | tests/analytics/delivery + withdrawal-race green | c3f39ddd1 | 2026-07-29 |
| Release execution route | tests/debug/settings/admin/analytics-routes green (deny matrix, execute, idempotency, sink gating) | af2eae8ec | 2026-07-29 |
| Stage B report CLI | tests/analytics/jobs/stage-b-report + stage-b-assess green; zero-write proof; smoke run recorded | 86c82e1db | 2026-07-29 |
| Final-review fix wave (day-scoped delta classification + four hardenings) | tests/analytics/jobs + tests/debug/settings/admin + tests/analytics/delivery green; re-review all six findings resolved | 5ad46b7ce | 2026-07-29 |
| Message-edit analytics (edit_classified/edit_regen registration, emission, funnel card) | registry-driven sweeps green (contracts, closure, privacy-contract, eligibility, snapshot props/schema); tests/message-edit + tests/analytics/edit-observer + metabase-models green; typecheck/lint/knip clean | 369473878, ea232ac6b, 2c8890af4, 0e69a9177, 35b0fb2ee | 2026-07-29 |

## Message-edit analytics coverage (post-rebase analysis, 2026-07-29)

Master's message-edit feature (`src/message-edit/`, landed between
9e6760773 and be67c2227) was analyzed for analytics coverage after the
Stage B readiness rebase. Decisions (product-owner call, 2026-07-29):

| Edit path | Decision | Rationale |
|---|---|---|
| Baseline (W3 + metadata/history correction) | Stays silent — correct by design | The message was counted at original receipt; counting the edit would double-count accepted messages |
| W1 (edit arrives during an active run) | **Covered**: emits the existing `turn_steered` fact through the shared mid-run steering boundary (commit 1acd7319a; same event, same semantics, shared per-run ordinal sequence; no `chat_message_accepted` — a correction is not a newly accepted message) | Friction Signature v1 steering component stays complete for edit-steers |
| W2 (regen turn after edit of the last message) | **Covered via amendment** (catalog §14.1): edit_classified + edit_regen standalone friction companions; no turn/session/outcome semantics (reserved for a future RQ3 amendment) (impl: 369473878, ea232ac6b, 2c8890af4, 0e69a9177, 35b0fb2ee) | Turn-level coverage needs new vocabulary (`'edit'` invocation mode or a regen fact family) — a 02-metric-catalog amendment through the governance path (08 sign-off rules), not a silent code definition. Follow-up: propose the amendment before or during Stage C planning |
| Auth boundary for edits | No `auth_checked` fact — consistent | Edits are not new accepted messages |

Gate evidence for 1acd7319a: tests/message-edit 35 pass / 0 fail (incl. the
W1 `turn_steered` fact + no-double-count assertions), typecheck/lint/format
clean.

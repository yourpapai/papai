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
| 2 | Strict schema fuzz | partial | strict envelope + rejection coverage in contracts/event-props-behavior tests (080198417); formal privacy-contract suite lands in Task 18 |
| 3 | C3 canaries | green | text/username/prompt/args/result/error/URL/hostname/filename/project/status/tag/RRULE/token/raw-ID canary scans over normalized JSON in tests/analytics/normalizer.test.ts (c4079feb8); 2026-07-24 |
| 4 | Identity matrix | green | frozen vectors + namespace/session/Discord/guest matrix (748a57bbf) + two-actor cached-descriptor/shared-pool attribution proof in tests/llm-orchestrator-tools.test.ts (1f68f3caf); 2026-07-25 |
| 5 | Raw-ID absence | partial | raw-ID canary scans prove only purpose-keyed pseudonyms survive in canonical JSON (tests/analytics/normalizer.test.ts, c4079feb8); captured-egress part lands in Task 15 |
| 6 | Semantic outcome | green | exactly-one terminal classification in tests/llm-orchestrator-tool-events.test.ts ('analytics terminal ordering') + tests/llm-orchestrator-tool-terminal.test.ts; SDK-success structured failure never maps to semantic success in tests/analytics/llm-tool-integration.test.ts (6d429b5c4); 2026-07-25 |
| 7 | Consent matrix | partial | 38,880-cell exact-decision Cartesian matrix in tests/analytics/governance/eligibility.test.ts (ab504fd5e); Task 5 wires decideEligibility into the live observer fail-closed incl. preference/ref reads (c4079feb8); store/send/delete result coverage completes with Tasks 15/16 |
| 8 | Withdrawal race | partial | local collection-ref races proven in tests/analytics/collection-writer-race.test.ts: deny-before-write yields no canonical/association rows; write-before-deny is found via analytics_event_collection_refs and deleted; repeated across retained key versions (c4079feb8); external delivery-grant race lands with the outbox tasks |
| 9 | Outbox/sink | partial | store parts: migration 072 restrictive sink/event FKs, nine-state closed ledger, single-enabled-sink partial unique index, independent minimal deletion receipts, enqueue/lease/send-start/recovery race proofs in tests/analytics/delivery/store.test.ts, capability gate incl. OpenPanel negative fixture in tests/analytics/delivery/sink.test.ts, write-only sink lifecycle in tests/analytics/delivery/sink-service.test.ts (9ac052ff0); transport/captured-egress parts land with the outbox sender tasks |
| 10 | Session fixtures | green | sessionization v1 boundary fixtures 29:59/30:00/30:00.001, out-of-order/midnight-UTC/two-actors-one-thread/sibling-thread/Discord-null-thread/command/proactive/bot-only-reply/zero-duration fixtures, child-inherit vs activity-extend semantics, and guests-produce-no-session-rows proof in tests/analytics/derive/sessionizer.test.ts + tests/analytics/sessionizer.test.ts (35693a333); 2026-07-26 |
| 11 | Cohort/censor fixtures | green | immature (<24h) attempts censored never abandoned, withdrawal/deletion right-censoring (deny → censored + censor-interval materialization, deleteCanonicalEventsForRef cascades derived rows, interval survives), clarification_abandoned deny-after-scan/before-insert and writer-before-deny races via inherited ref in tests/analytics/outcomes.test.ts; censor-interval table in migration 073 (35693a333); 2026-07-26 |
| 12 | Rephrase persistence audit | green | transient in-memory lifecycle (capture discards raw text at the boundary, 30-minute TTL, max 3 sets per conversation, eviction/expiry/shutdown coverage-loss accounting, withdrawal without loss) in tests/analytics/rephrase/*.test.ts + tests/analytics/rephrase-handoff.test.ts; post-auth canary never survives capture or derivation in tests/analytics/intent-persistence-audit.test.ts (dccf6cc73); 2026-07-26 |
| 13 | Classifier contract | green | sealed-corpus hybrid parity with the frozen PoC values (accuracy 0.991667, macro F1 0.995641, coverage 0.991667, unknown precision 0.909091) in tests/analytics/intent-classifier.test.ts; derived intent_classified envelope/props contract + deterministic intent-output:v1 ids + inherited-ref withdrawal in tests/analytics/intent-derivation.test.ts; no PoC/small-model import in the runtime module graph + latency budget in tests/analytics/intent-persistence-audit.test.ts (dccf6cc73); 2026-07-26 |
| 14 | Backfill/provenance/reconciliation | green | one controlled decision per durable row (aggregate_only/rejected with exact controlled reasons; current rows never canonical/pseudonym/`unknown`), HMAC source references, provenance rerun = zero changes, interrupt/resume identical decisions, rollback reverses only first-created deltas, durable equation `usage_rows = canonical + rejected + ineligible + aggregate_only` with zero unexplained delta on closed epochs, open/stale epochs → `unreconciled_restart_gap` (no numeric plug) in tests/analytics/backfill.test.ts + tests/analytics/reconciliation.test.ts; fixture CLI dry-run/apply/reconcile status=reconciled unexplained_delta=0, rerun applied=0 (ff0df9c24); 2026-07-26 |
| 15 | External thresholding | pending | |
| 16 | DSAR/delete/rekey/snapshot | pending | |
| 17 | Performance/expiry clocks | pending | |

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
| 13 — lifecycle/subject rights | | | | |
| 14 — snapshot/metabase | | | | |
| 15 — aggregate delivery | | | | |
| 16 — settings surfaces | | | | |
| 17 — job registration | | | | |
| 18 — docs/release gates | | | | |

## Milestone rebases onto origin/master

| After task | Rebase commit | Date | Conflicts / resolution |
|---|---|---|---|
| 2 | rebased onto origin/master 0e5cfcc9e | 2026-07-24 | master added `069_alert_matched_task_ids`; analytics migration block renumbered to 070–073 per 06's own renumber rule (plan-sync commit follows) |
| 8 | rebased onto origin/master 998f394cc | 2026-07-26 | master's 76334f1f6 rewrote two test files; merged: kept master's suites + preserved our scope-free descriptor assertion (collaboration-tools-builder) and scope-passthrough tests (auto-provision, adapted to required 5th scope param) |
| 13 | | | |

## Stage A exit checklist

- [ ] All 18 task commits recorded above with hashes
- [ ] Control matrix all green
- [ ] Synthetic complete process epoch reconciles to zero (attach output)
- [ ] Snapshot byte verification result recorded
- [ ] Deletion drill output recorded
- [ ] Rekey drill output recorded
- [ ] Task 18 binding commands all pass, outputs attached:
  `bun build:client`, `bun test tests/analytics tests/settings`,
  `bun test:client`, `bun run typecheck`, `bun run lint`, `bun security`,
  `bun run test`, `bun test:stories:contracts`, `bun test:stories`,
  `bun run format:check`, `bun security:ci`, `bun run knip`,
  `bun run duplicates`
- [ ] Privacy/security owner signature on this evidence

**Privacy/security owner signature:** ____________________  date: ________

## Stage B window log (post-merge, operational)

- Deploy date / version:
- Window start (UTC):
- Window end (UTC):
- Restart/suppressed days (`unreconciled_restart_gap`):

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
  (198.18.x.x) that `assertPublicUrl` blocks; expected green in CI.
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

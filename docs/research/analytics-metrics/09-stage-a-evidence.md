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
| 9 | Outbox/sink | pending | |
| 10 | Session fixtures | pending | |
| 11 | Cohort/censor fixtures | pending | |
| 12 | Rephrase persistence audit | pending | |
| 13 | Classifier contract | pending | |
| 14 | Backfill/provenance/reconciliation | pending | |
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
| 8 — provider/feature boundaries | 8A: 270 pass / 0 fail (provider-observer, provider-request-scope, wrapper, builders, orchestrator, deferred-prompts, disclosure, compaction, tool-failure); fallback-open coverage 2249f2f60 | clean / clean (knip clean) | 8A: 1f68f3caf | 2026-07-25 |
| 9 — delivery ledger | | | | |
| 10 — intent + rephrase | | | | |
| 11 — materializations | | | | |
| 12 — backfill/reconcile | | | | |
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
| 8 | | | |
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

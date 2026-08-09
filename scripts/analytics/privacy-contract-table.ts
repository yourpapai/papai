// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The 17 release-blocking analytics privacy controls and the test files that prove them.
 *
 * One definition, two consumers: `tests/analytics/privacy-contract.test.ts` asserts the
 * table's shape (17 rows, non-empty proof points, every fixture path on disk), and
 * `privacy-contract-gate.ts` asserts that every fixture named here passed in the run
 * that is gating the release. Neither may carry its own copy — a control whose proof
 * moved in one list and not the other would be a control nobody checks.
 *
 * This lives in `scripts/`, not `src/`: it is release tooling, never loaded by the
 * running bot, and control 13 is specifically about what does *not* enter the runtime
 * module graph.
 */

export type ContractRow = Readonly<{
  control: number
  name: string
  proofPoints: readonly string[]
  fixtures: readonly string[]
}>

export const PRIVACY_CONTRACT: readonly ContractRow[] = [
  {
    control: 1,
    name: 'registry closure',
    proofPoints: ['registry closure across contracts/registry/metric map', 'feature uniqueness'],
    fixtures: ['tests/analytics/registry-closure.test.ts', 'tests/analytics/feature-opportunity.test.ts'],
  },
  {
    control: 2,
    name: 'strict schema fuzz',
    proofPoints: [
      'strict envelope acceptance',
      'rejection fuzz: unknown event/props/version/enum, nested data, non-finite or negative durations, oversized arrays, free-form strings',
    ],
    fixtures: ['tests/analytics/contracts.test.ts', 'tests/analytics/event-props-behavior.test.ts'],
  },
  {
    control: 3,
    name: 'C3 canaries',
    proofPoints: [
      'text/username/prompt/args/result/error/URL/hostname/filename/project/status/tag/RRULE/token/raw-ID canary scans over normalized JSON',
    ],
    fixtures: ['tests/analytics/normalizer.test.ts'],
  },
  {
    control: 4,
    name: 'identity matrix',
    proofPoints: [
      'frozen HMAC byte/digest vectors',
      'namespace/session/Discord effective conversation/guest matrix',
      'two-actor cached-descriptor/shared-pool attribution',
    ],
    fixtures: [
      'tests/analytics/keyring.test.ts',
      'tests/analytics/pseudonym.test.ts',
      'tests/analytics/identity/scope.test.ts',
      'tests/analytics/install-id.test.ts',
      'tests/llm-orchestrator-tools.test.ts',
    ],
  },
  {
    control: 5,
    name: 'raw-ID absence',
    proofPoints: [
      'raw-ID canary scans: only purpose-keyed pseudonyms survive in canonical JSON',
      'captured-egress proof over poisoned source facts',
      'request-scoped provider overlap/cache isolation and log canaries',
    ],
    fixtures: [
      'tests/analytics/captured-egress.test.ts',
      'tests/analytics/delivery/captured-sink.testing.test.ts',
      'tests/analytics/provider-request-scope.test.ts',
      'tests/analytics/provider-request-scope-setup-paths.test.ts',
    ],
  },
  {
    control: 6,
    name: 'semantic outcome',
    proofPoints: [
      'exactly-one terminal classification',
      'post-classification tool terminal per idempotent source ID',
      'command production DI',
      'SDK-success structured failure never maps to semantic success',
    ],
    fixtures: [
      'tests/llm-orchestrator-tool-events.test.ts',
      'tests/llm-orchestrator-tool-terminal.test.ts',
      'tests/analytics/llm-tool-integration.test.ts',
      'tests/analytics/tool-classification.test.ts',
      'tests/runtime/production-deps-analytics.test.ts',
    ],
  },
  {
    control: 7,
    name: 'consent matrix',
    proofPoints: [
      '38,880-cell exact-decision mode x basis x preference x role matrix',
      'live observer fail-closed eligibility',
    ],
    fixtures: ['tests/analytics/governance/eligibility.test.ts', 'tests/analytics/eligibility-matrix.test.ts'],
  },
  {
    control: 8,
    name: 'withdrawal race',
    proofPoints: [
      'collection-writer races: deny-before-writer inserts nothing, writer-before-deny deleted before ack',
      'delivery-grant races at enqueue/lease/send-start with per-grant send mutex',
      'one-transaction withdrawal with in-tx cancel',
    ],
    fixtures: ['tests/analytics/collection-writer-race.test.ts', 'tests/analytics/withdrawal-race.test.ts'],
  },
  {
    control: 9,
    name: 'outbox/sink',
    proofPoints: [
      'nine-state closed ledger with single-enabled-sink partial unique index',
      'send-start crash states: never-started lease retries, uncertain cases become non-retried ambiguous',
      'sink lifecycle/ambiguous/SSRF pinning',
      'restrictive event FK and minimal independent receipts',
    ],
    fixtures: [
      'tests/analytics/delivery/store.test.ts',
      'tests/analytics/delivery/sink.test.ts',
      'tests/analytics/delivery/sink-service.test.ts',
      'tests/analytics/delivery/pinned-transport.test.ts',
      'tests/analytics/delivery/worker.test.ts',
      'tests/analytics/delivery/delivery-lifecycle.test.ts',
      'tests/analytics/delivery/settlement.test.ts',
      'tests/analytics/sink-gate.test.ts',
      'tests/analytics/sink-lifecycle.test.ts',
      'tests/analytics/delivery-store.test.ts',
    ],
  },
  {
    control: 10,
    name: 'session fixtures',
    proofPoints: [
      'sessionization boundaries 29:59/30:00/30:00.001',
      'out-of-order/midnight-UTC/two-actors-one-thread/sibling-thread/Discord-null-thread fixtures',
      'guests produce no session rows',
    ],
    fixtures: ['tests/analytics/derive/sessionizer.test.ts', 'tests/analytics/sessionizer.test.ts'],
  },
  {
    control: 11,
    name: 'cohort/censor fixtures',
    proofPoints: [
      'immature attempts censored never abandoned',
      'withdrawal/deletion right-censoring with censor-interval materialization',
      'clarification_abandoned deny-after-scan and writer-before-deny races',
    ],
    fixtures: ['tests/analytics/outcomes.test.ts'],
  },
  {
    control: 12,
    name: 'rephrase persistence audit',
    proofPoints: [
      'transient in-memory lifecycle: capture discards raw text, 30-minute TTL, max 3 sets',
      'post-auth canary never survives capture or derivation',
    ],
    fixtures: [
      'tests/analytics/rephrase/state.test.ts',
      'tests/analytics/rephrase/matching.test.ts',
      'tests/analytics/rephrase/outcome.test.ts',
      'tests/analytics/rephrase/handoff.test.ts',
      'tests/analytics/rephrase-handoff.test.ts',
      'tests/analytics/intent-persistence-audit.test.ts',
    ],
  },
  {
    control: 13,
    name: 'classifier contract',
    proofPoints: [
      'sealed-corpus hybrid parity with the frozen PoC values',
      'derived intent_classified envelope with deterministic intent-output:v1 ids',
      'no PoC/small-model import in the runtime module graph',
    ],
    fixtures: ['tests/analytics/intent-classifier.test.ts', 'tests/analytics/intent-derivation.test.ts'],
  },
  {
    control: 14,
    name: 'backfill/provenance/reconciliation',
    proofPoints: [
      'one controlled decision per durable row with HMAC source references',
      'provenance rerun zero-change and interrupt/resume identical decisions',
      'first-create rollback maps',
      'recoverability matrix',
      'process-epoch associations and the durable source equation with zero unexplained delta',
      'restart gap receives no numeric plug',
    ],
    fixtures: ['tests/analytics/backfill.test.ts', 'tests/analytics/reconciliation.test.ts'],
  },
  {
    control: 15,
    name: 'external thresholding',
    proofPoints: [
      'frozen one-way release lattice: total plus one-way children only',
      'primary thresholds and complementary suppression',
      'deterministic content-hash releaseId with idempotent rebuild',
      'restart-gap publication blocks',
    ],
    fixtures: [
      'tests/analytics/delivery/release-suppression.test.ts',
      'tests/analytics/delivery/aggregate-release.test.ts',
    ],
  },
  {
    control: 16,
    name: 'DSAR/delete/rekey/snapshot',
    proofPoints: [
      'authenticated DSAR export and deletion workflow across all retained key versions',
      'encrypted deletion targets destroyed only after local/snapshot/remote completion',
      'post-high-water dual-write rekey with retirement gating',
      'Metabase inode close/remount verification',
      'snapshot staging cleanup on success and failure',
    ],
    fixtures: [
      'tests/analytics/governance/subject-export.test.ts',
      'tests/analytics/governance/subject-deletion.test.ts',
      'tests/analytics/governance/deletion-target-store.test.ts',
      'tests/analytics/rekey.test.ts',
      'tests/analytics/rekey-cutover.test.ts',
      'tests/analytics/snapshot.test.ts',
    ],
  },
  {
    control: 17,
    name: 'performance/expiry clocks',
    proofPoints: [
      'monotonic TTFT/first-visible-feedback clocks with not-applicable/negative/implausible rejection',
      'deadline expiry guard at every read/derive/export/snapshot/lease/send boundary',
      'startup purge barrier and earliest-deadline wake',
    ],
    fixtures: [
      'tests/analytics/performance-clocks.test.ts',
      'tests/analytics/retention.test.ts',
      'tests/analytics/derive/store.test.ts',
    ],
  },
]

/**
 * Every distinct proof fixture across the table, in first-appearance order.
 *
 * Deduplicated because several controls lean on the same file: the gate asks about
 * files, and a file that passed once passed for every control naming it.
 */
export function privacyContractFixtures(): readonly string[] {
  return [...new Set(PRIVACY_CONTRACT.flatMap((row) => row.fixtures))]
}

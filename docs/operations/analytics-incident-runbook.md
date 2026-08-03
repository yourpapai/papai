<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics incident runbook

> Response procedure for privacy, integrity, and reconciliation incidents in
> papai analytics. Normal operations: [`analytics-runbook.md`](./analytics-runbook.md).
> Pause triggers below are normative (from
> `docs/research/analytics-metrics/07-validation-and-review-ritual.md` §7).

## 1. Immediate containment (do these first, in order)

1. **Kill switch.** Set `ANALYTICS_KILL_SWITCH=1` in the deployment environment
   and restart the bot. Every lane — local collection and both external egress
   lanes — resolves off at the next policy resolution regardless of the stored
   `analytics_policy` row (`resolveEffectiveLanes`,
   `src/analytics/governance/policy-store.ts`). No policy write or migration is
   needed; the stored policy is preserved for forensics.
2. **Egress stop (no-restart alternative/addition).** While the restart
   propagates, also stop egress at the control plane:
   `PATCH /settings/api/admin/analytics` with
   `external_aggregate_enabled: false` and
   `external_pseudonymous_enabled: false`, and disable the implicated sink:
   `POST /settings/api/admin/analytics/sinks/<sinkVersionId>/disable`. Sink
   disable/rotate retains every historical sink version and ledger row — no
   evidence is erased.
3. **Stop/drain analytics jobs.** The bounded lifecycle jobs (derive, intent,
   retention purge, backfill/reconcile, snapshot, delivery) are scheduler
   registrations — they drain at the next tick boundary; the kill switch makes
   the delivery worker and collectors no-op. Do not delete rows yet.
4. **Cancel pending delivery** once lanes are off, so nothing leaves after the
   incident window: withdrawal-style cancellation marks `pending`/`leased`
   rows `cancelled`; `sending`/`ambiguous` rows are **not** retried or
   silently removed — they settle through explicit reconciliation.

## 2. Scope the incident

Record, without copying any unsafe payload:

- **Affected definition/schema/event versions** — which contract versions were
  accepted outside registry closure, or which sink payload versions sent.
- **Affected UTC windows** — intersecting process epochs
  (`analytics_process_epochs`), their state (`closed` vs `stale_open`), and
  every UTC bucket each epoch touches. Any window intersecting a stale-open
  epoch is `unreconciled_restart_gap`: it receives no balancing term and stays
  blocked from publication/release/evidence until it expires.
- **Affected sinks and sink versions** — from `analytics_sinks` plus the
  delivery ledger (`analytics_deliveries`, `analytics_aggregate_deliveries`);
  note which states exist (`pending`/`leased`/`sending`/`delivered`/
  `ambiguous`/`dead`/`delete_pending`/`deleted`/`cancelled`).
- **Affected key versions / storage generations** — the active generation
  pointer and any in-flight rekey run (`planned`/`running`/`paused`).

## 3. Exposure classification

Classify before any remediation; the class drives the delete/rebuild scope:

| Class | Meaning | Examples |
|---|---|---|
| C3 content exposure | message text, prompts, usernames, tokens, free-form errors, filenames, URLs/hostnames persisted or egressed | normalizer bypass, raw `props_json` in a snapshot or captured request |
| Raw-ID exposure | native actor/context/task/turn/tool/model/coding identifiers on any analytics surface | unpseudonymized keys, cross-instance identity collision, guest continuity |
| Governance breach | writer-after-deny, send-after-withdrawal, send-after-acknowledgement, consent-basis violation | collection/delivery race loss, eligibility fail-open |
| Integrity breach | unexplained reconciliation delta, orphaned `sending` replay, incomplete sink deletion, deletion acknowledged early | counter drift, crash between send-start and settle |
| Key compromise | HMAC keyring, governance keyring, or `INSTANCE_CONFIG_KEY` material exposed | key file leak, unaudited endpoint/sink change |
| Schema breach | a schema/event/property version accepted without registry closure | strict-decoder bypass |

Any C3 or raw-ID finding — however small — is release-blocking and returns the
deployment to Stage A after remediation.

## 4. Remediate

### Local delete/rebuild

1. Run the deletion workflow for affected actors/refs (the same machinery as
   `POST /settings/api/analytics/delete`): canonical events and derived rows
   cascade; censor intervals materialize for withdrawn cohorts; encrypted
   deletion-target bundles are destroyed only after local + snapshot + remote
   completion.
2. Rebuild affected materializations (derive jobs are idempotent over the
   rebuilt canonical set) and any aggregate cells the incident rows fed.
3. Rebuild and replace the published snapshot
   (`bun run scripts/analytics-snapshot.ts --output <path> --verify --replace`)
   and complete the consumer close/remount/reopen verification (new snapshot
   ID, zero deleted-subject contribution) **before** acknowledging any
   deletion. Pointer-only replacement is not evidence.

### Remote delete/rebuild

1. For affected actors, issue per-actor remote deletion for **every retained
   key version** against each sink that received pseudonymous rows; keep the
   minimal independent receipts (deletion-request/sink IDs, controlled state,
   receipt hash, time — never event/actor/remote bodies).
2. For aggregate sinks, cancel pending releases and reconcile delivered
   release IDs against destination totals; retain receipt hashes 30 days.
3. `ambiguous` deliveries stay visible and non-retried until explicitly
   reconciled with the destination's documented dedup semantics.

### Key compromise — epoch break

1. Rotate the compromised keyring out of the environment; if
   `INSTANCE_CONFIG_KEY` is implicated, rotate sink secrets as well.
2. Run a planned rekey to a fresh generation:

   ```bash
   bun run scripts/analytics-rekey.ts plan --source-gen <old> --target-gen <new> --from-versions <old-v> --to-versions <new-v>
   bun run scripts/analytics-rekey.ts apply --run-id <id> --plan-hash <hash>
   bun run scripts/analytics-rekey.ts verify --run-id <id>
   ```

   The cutover fence drains every mutable writer; count/hash conservation over
   the frozen high-water plus the fully drained delta must pass before the
   singleton pointer swaps. Pseudonymous egress stays paused until every old
   remote actor version is deleted and reconciled; old receipts remain
   immutable. BI stays quiesced until a newly built snapshot's embedded
   generation, published row, and active pointer all agree.
3. If a run wedges `paused` post-dual-write, resume with `apply` — never
   `abort` (abort is valid only for a pristine plan-phase run). A second
   nonterminal run is itself a pause-trigger incident.

### Backfill rollback (privacy/identity-caused)

Stop the run without advancing the uncommitted checkpoint, disable
pseudonymous collection, select exact event IDs through
`analytics_backfill_event_map(run_id, …)`, settle/remove that run's
deliveries, reverse only its first-created deltas in
`analytics_backfill_aggregate_contributions` in one reviewed transaction,
delete its mapping rows only after source/event uniqueness and non-negative
cells verify, then reconcile to zero before resuming.

## 5. Reconciliation proof (required to close)

The incident is not closed until all of the following hold and are attached to
the incident record:

1. **Zero unexplained source delta** for every complete (closed) process epoch
   intersecting the incident window:
   `bun run scripts/analytics-backfill.ts --reconcile` (or
   `POST /settings/api/admin/analytics/reconcile` with `{"apply": true}`)
   prints `status=reconciled unexplained_delta=0`.
2. **Zero event/aggregate epoch-association delta** and **zero delivery-state
   delta**, including every `sending`/`ambiguous` row explicitly resolved.
3. **Zero privacy canary**: rerun the synthetic C3/raw-ID captured-request scan
   (`bun test tests/analytics/privacy-contract.test.ts`) and the control suite
   relevant to the exposure class; snapshot bytes re-verify
   (`scripts/analytics-snapshot.ts … --verify`).
4. Every `unreconciled_restart_gap` window named in the incident record is
   still marked and excluded from publication/evidence — it is never closed by
   an invented numeric loss term.

Resume stages only after affected rows/materializations are deleted or
rebuilt, the blocking regression test exists, and the same evidence chain
passes end to end. Reopen rollout at the last stage whose exit evidence
remains valid.

## 6. Pause triggers (normative)

Pause pseudonymous collection/egress immediately for:

- any C3 or raw-ID persistence/egress;
- cross-instance identity collision or guest continuity;
- writer-after-deny, send-after-withdrawal, orphaned `sending` replay, or
  incomplete sink deletion;
- deletion acknowledgement while a target bundle, restricted delivery row, or
  old open snapshot inode remains;
- a second nonterminal rekey run, or any served snapshot whose embedded,
  published, and active storage generations differ;
- unexplained reconciliation difference;
- key compromise or unaudited sink/endpoint change;
- a schema version accepted without registry closure.

Separately, an `unreconciled_restart_gap` pauses publication and every external
release for its affected windows and prevents them from counting as rollout
evidence. It does not become an invented numeric loss term.

## 7. Incident record

Record, content-free: period, data snapshot ID, model/definition versions,
coverage, exposure class, affected windows/sinks/key versions, containment
actions, deletion/rebuild actions, reconciliation proof, owner, and follow-up.
Never copy an unsafe payload into the record.

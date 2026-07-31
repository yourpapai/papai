<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Governance sign-off — metric catalog and privacy design

**Record date:** 2026-07-24
**Status:** APPROVED (design documents). This record signs off the *design*;
enabling any collection mode beyond `local_aggregate` additionally requires the
release-blocking contract to be implemented and reviewed per
[`03-privacy-consent-threat-model.md`](./03-privacy-consent-threat-model.md) §14
and the stage evidence in
[`06-implementation-plan.md`](./06-implementation-plan.md).
**Documents under review:**

- [`02-metric-catalog.md`](./02-metric-catalog.md) (2026-07-23)
- [`03-privacy-consent-threat-model.md`](./03-privacy-consent-threat-model.md) (2026-07-23)

## What this gate is

[`00-overview.md`](./00-overview.md) requires named operator/product/privacy
sign-off before any pseudonymous collection, classifier text processing,
real-data validation, or sink enablement proceeds. This document records that
sign-off and its conditions. It approves the definitions and the privacy
posture as the binding implementation contract; it does not switch anything on.

## Product attestations (against 02)

1. RQ1–RQ8 as defined answer the product questions in scope; no additional
   question requires content-bearing data.
2. Funnel definitions are accepted as product truth: activation (7/14-day
   windows, preconfigured actors excluded), task creation (same-turn unit),
   and coding discovery (with the direct-start alternate path).
3. Outcome v1 is accepted: goal-satisfying success requires semantic success,
   recovered attempts are never reported as first-time success, and censoring
   is distinct from abandonment and churn.
4. Friction Signature v1 is accepted: seven transparent binary components
   (R/C/P/S/L/D/F), no hidden weights, used to sample sessions for UX review —
   never to rank actors, groups, or models.
5. `intent.v1` (23 labels) is accepted as immutable; renames/merges/splits
   produce a successor taxonomy and dashboards never reinterpret stored labels.
6. Dashboard honesty requirements are accepted: every card shows numerator,
   denominator, unknown/censored count, coverage, definition version, UTC
   window, and snapshot age; percentages hide below denominator 30; zero, null,
   censored, and not-applicable are distinct display states.
7. Guests appear only as aggregate context metrics, never as longitudinal
   actors.

## Privacy/security attestations (against 03)

1. Collection modes and defaults are approved: `off`; `local_aggregate` as the
   shipping default; `local_pseudonymous` gated on governance setup;
   `external_aggregate` off; `external_pseudonymous` always default-off and
   requiring both the operator switch and an actor-level `allow`.
2. The anonymity model is approved: purpose-separated, versioned HMAC
   pseudonyms with key material stored encrypted outside the analytics
   database; `stats_anonymity_salt` is never reused; platform instances are
   namespaced; there is no cross-platform person graph.
3. The consent/eligibility model is approved: actor preference scoped to
   `(platform_instance_id, platform_user_id)`; consent-unknown actors are
   ineligible in consent mode; `deny` always wins; writer/delivery rechecks are
   serialized against withdrawal; no retroactive collection of pre-eligibility
   steps.
4. The guest policy is approved: aggregate-only, no guest pseudonym, external
   cells suppressed below 10 guest turns or 10 distinct contexts.
5. Retention and deletion are approved: 90-day pseudonymous events/sessions;
   pending delivery bounded by event expiry or 14 days; 30-day delivery
   receipts; 400-day thresholded aggregates and superseded policy audit;
   expiry enforced as a read/send boundary with a startup purge barrier; DSAR
   export/delete spans every key version, storage generation, published
   snapshot, and approved sink.
6. The key lifecycle is approved: stable keys for the retention horizon;
   rekey only as the durable, resumable plan → dual-write → copy → verify →
   cutover → snapshot → remote → retire workflow; 90-day subject-rights lookup
   horizon after swap; on compromise, stop egress first and accept a cohort
   epoch break rather than retain raw identities.
7. The threat model (19 threats) and the 17 release-blocking controls are
   approved as CI gates: controls block pseudonymous collection/egress, and
   controls 1–9, 14–17 plus the aggregate-specific parts of 15 also block
   aggregate publication.
8. SMALL_MODEL intent tagging remains off until its independent benchmark,
   processor, retention, deletion, and egress gates pass.
9. The provider posture is ratified: OpenPanel's production pseudonymous-sink
   gate failed (destination idempotency, deterministic export, per-profile
   erasure, session fidelity); self-hosted PostHog is rejected; any future sink
   must pass the strict AND of caller-controlled destination idempotency,
   deterministic reconciliation, and complete per-actor deletion before
   evaluation proceeds.

## Decision record

| Role | Name | Decision | Date | Conditions |
|---|---|---|---|---|
| Product owner | Dmitriy Lazarev (project owner) | Approved | 2026-07-24 | — |
| Privacy/security owner | Dmitriy Lazarev (project owner) | Approved | 2026-07-24 | An independent privacy/security reviewer must re-sign 03 before any Stage D/E external egress evaluation |

**Combined-role note.** papai is a single-owner project, so the product and
privacy/security attestations are signed by the same person. This weakens
separation of duties and is recorded deliberately: local lanes (Stages A–C)
may proceed on this sign-off, but external egress raises the bar and requires
an independent reviewer as stated above.

## Reopening conditions

This record is void and the gate reopens if any of the following change after
2026-07-24: a metric/outcome/friction/funnel definition in 02, the `intent.v1`
taxonomy, a collection-mode default, the consent/eligibility or guest policy,
retention maxima, the deletion/DSAR contract, the rekey workflow, or any of
the 17 release-blocking controls. Definition changes land only as successor
versions per the immutability rules in 02; the successor requires its own
sign-off before activation.

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 announcement delivery fan-out design

Date: 2026-07-30
Status: approved

## Decision

The next Phase 3 delivery-and-privacy story slice promotes exactly one Tier-0-ready
catalog record: `SCN-announcement-delivery-fanout`.

`SCN-stats-anonymity` and `SCN-stats-aggregate-window` remain pending, separate
follow-up slices. Although all three records are Tier-0-ready, they cover distinct
trust planes and invariants: a super-admin settings write and remote delivery versus
dashboard-session-protected read payload privacy and aggregate mathematics. Combining
them would make failures and review ownership harder to isolate.

## Scope

The future delivery must add one Tier-0 hermetic story through the existing release
notes broadcast flow:

```text
authenticated super-admin + CSRF
  -> POST /settings/api/admin/release-notes { action: "broadcast" }
  -> broadcastAnnouncement()
  -> bounded, failure-isolated DM/group delivery
  -> per-recipient delivery status + aggregate response summary
```

The story is the sole literal mapping for `SCN-announcement-delivery-fanout`. Existing
admin release-notes and billing/stats stories stay adjacent coverage only; they do not
claim its independent fan-out invariant.

## Behavioral contract

For one fixed version and announcement body, deterministic fixtures provide eligible
subscribed DMs and groups plus at least one ineligible recipient. A fake chat transport
records delivery attempts and supplies predetermined success, returned-failure, and
thrown-failure outcomes.

The story must prove:

- Every eligible subscribed DM and group has exactly one delivery attempt.
- A successful attempt increments `sent`; a returned `false` or thrown error increments
  `failed`; neither outcome prevents all remaining recipients from being attempted.
- A recipient already recorded as successfully delivered increments `skipped` and is
  not retried.
- `sent + failed + skipped` equals the number of eligible recipients.
- Each attempted recipient has the matching persisted `sent` or `failed` status, and a
  prior successful delivery remains idempotent on a later broadcast.
- The version is marked broadcast after the entire fan-out has settled, including
  individual failures.

The implementation may perform bounded concurrent sends. The story must therefore
assert the complete attempt set and summary rather than delivery order or wall-clock
timing.

## Authentication and privacy

The story establishes that an unauthenticated request, a non-admin settings session,
and a missing or invalid CSRF token are rejected before any delivery occurs. The
successful request uses a valid super-admin settings session and synchronizer token.
No delivery capability becomes public.

Recipient identity remains confined to the delivery seam, persistent delivery rows,
and structured logs. The administrative response returns only the aggregate
`sent`/`failed`/`skipped` outcome and existing subscriber counts. It must not expose
recipient IDs, names, per-recipient error details, or any additional announcement body
beyond the operator-managed draft.

This slice does not broaden `/stats/*`, whose dashboard-session authentication and
anonymous aggregate payload contract remain independent.

## Error handling

Each send is best effort. A transport failure represented by `false` and an exception
are both recorded as a failure for that recipient. A failure is isolated: it neither
aborts fan-out nor suppresses recording and attempted delivery for other eligible
recipients. Idempotent successes are skipped; failed rows remain eligible for a later
attempt under the existing delivery-store semantics.

## Verification

The future story must prove the authorization failures happen before transport use;
then prove the exact eligible attempt set, independent success/failure accounting,
persistent delivery outcomes, skip semantics, and final aggregate response. Its
deterministic inputs are a fixed version, fixed body, explicit subscriber state, fixed
transport outcomes, and no assertion on concurrent ordering.

When implemented, the verification gate is the literal Tier-0 story plus the catalog
contracts and normal Tier-0 story command. Only
`SCN-announcement-delivery-fanout` moves from pending to executable.

## Deferred stats obligations

`SCN-stats-anonymity` remains a separate privacy story. It must seed identifiable and
free-form sentinel values across global and subject-derived source rows, make
authenticated `/stats/global` and `/stats/subject/:id` reads, and prove their
serialized public payloads contain none of those markers or raw subject identity.

`SCN-stats-aggregate-window` remains a separate consistency story. It must use a
fixed clock and timestamped aggregate inputs to prove window inclusion, UTC daily
buckets, totals, distributions, and percentiles derive consistently from the same
rows. The story must bypass or reset the 60-second stats cache deterministically.

## Non-goals

- No production delivery, settings, dashboard, or stats behavior change.
- No change to `/stats/*` payload shape or authentication.
- No combined announcement-and-stats scenario.
- No catalog promotion, test fixture change, or implementation plan in this design
  document.

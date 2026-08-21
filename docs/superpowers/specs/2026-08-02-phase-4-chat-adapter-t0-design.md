<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4: Chat Adapter T0 Reachability

**Date:** 2026-08-02
**Status:** approved for planning

## Decision

Phase 4 adds Tier 0 behavior stories only for chat-adapter behavior that executes
without a platform transport: message normalization, adapter-owned context
rendering, interaction payload construction, and metadata capability gating. It
also adds one Tier 0 `audio-transcribe` story against a deterministic
OpenAI-compatible transcription host.

The three platform callback records remain deferred at `needs-seam@3`:

- `SCN-interaction-discord-router-wrapped`
- `SCN-interaction-discord-standalone-fallback`
- `SCN-interaction-telegram-callback`

They are not Tier 0 behaviors. Their proof requires the Discord or grammY event
wire above the adapter's normalized input boundary. Tier 3 is the nightly
platform-integrated regression lane for that work. It remains outside 0Q and is
reviewed manually or through T3, not made into a refactor qualification gate.

## Scope

### Tier 0 chat behavior

Add deterministic, cataloged T0 stories that run real production helpers and
assert observable results for these transport-free surfaces:

- normalized incoming message/context fields;
- `renderContext()` output for representative limited and unlimited context
  budgets;
- `IncomingInteraction` construction, including DM/group scoping and rejection
  of empty callback data;
- reply-surface behavior gated by declared chat capabilities.

The stories must use fixed platform instance IDs, users, context IDs, callback
data, and token counts. They may construct adapter-shaped input values, but must
not start an SDK client, polling loop, webhook server, or platform fake.

### Audio transcription host story

Add one T0 story for the real `audio-transcribe` plugin attachment transformer.
The story activates the plugin, stages a voice attachment, and routes the
transformer's cache-miss request through the existing strict fake-host mechanism.
The host validates the transcription endpoint and multipart request shape and
returns a fixed successful transcription response. The story asserts the
resulting inline transcript behavior.

Existing unit tests remain responsible for error and branch detail: missing or
incomplete configuration, quota denial, cache handling, oversized attachments,
timeouts, malformed responses, and upstream failures.

## Catalog And Coverage

Every new T0 story receives exactly one catalog claim with proving tier `0` and
participates in the existing T0 census. Update the catalog contract expectations
and deterministic coverage-total snapshot with the new executable records.

There is no mandated aggregate coverage uplift. The behavior stories themselves
are the acceptance criterion. A coverage floor is ratcheted only when a fresh,
full `bun test:stories:coverage` run measures above the committed value; it is
not edited to claim a target increase.

## Documentation

Add the following policy to `docs/architecture/commands.md` under `Hermetic story
qualification`:

> Chat adapter transport is Tier 3 evidence. It is a nightly/manual-review
> responsibility and cannot qualify a refactor through 0Q.

The documentation must name the three deferred Discord/Telegram records and
preserve their `needs-seam@3` status. It must not alter the nightly workflow,
promote those records, or add fake platform callback infrastructure.

## Non-Goals

- No Discord or grammY callback-wire fake.
- No new platform transport, webhook, polling, or SDK-client test.
- No change to Tier 3's nightly-only policy.
- No extension of 0Q beyond Tier 0.
- No aggregate story-coverage target or floor decrease.

## Verification

The implementation plan must verify:

1. T0 catalog contracts and census include each new scenario.
2. New T0 stories pass in the hermetic story runner.
3. The three transport records remain `needs-seam@3` and the T3 nightly lane is
   unchanged.
4. The audio host story consumes every declared fake-host request and has no
   undeclared I/O.
5. A full story-coverage run determines whether the monotonic floor can rise.

<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

`chat-participant-resolution` is the ledger's emptiest `partial` record: `proven: {}`,
with `primary` and `authorization-routing` both open at Tier 0. Its rationale is
explicit that `SCN-context-group-identity` proves only the member-roster substrate the
resolver queries — substrate, not evidence. Nothing the behavior actually claims is
proven.

It is first among Phase 2's seven behaviors on two readings: it needs no production
seam, and it sits in the `src/tools/` registration layer that
`plugin-core-separation-toolgate` is rewriting — so its open `authorization-routing`
dimension falls inside that refactor's one semantic blast radius (see "What closes a
dimension" in the roadmap design doc). `mid-run-control` shares the second property but
is `blocked:missing-implementation`.

## What Changes

- Add Tier 0 hermetic stories under `tests/stories/chat/` covering the behavior's two
  open dimensions:
  - **primary** — `resolve_chat_participant` registered and callable in a group turn;
    candidates gathered from `group_members` ∪ `message_metadata` senders; exact >
    prefix > substring ranking; the `displayName → username → userId` fallback chain;
    the resolved id reaching `delivery.mention_user_ids`.
  - **authorization-routing** — one scenario per **denial surface**: the tool absent in
    a DM context, and absent in a group when no `chatParticipantResolver` is injected
    (`src/tools/tools-builder.ts:270`). The deeper per-surface bar applies because this
    dimension is in the refactor's semantic edge.
- Add scenario-configurable `resolveUserLabel` to the story fake chat provider
  (`tests/stories/harness/chat.ts`) so the label path is exercised rather than always
  falling back. A fixture capability the real providers already implement — not a new
  production seam.
- Register the new scenarios in `tests/stories/catalog/coverage.ts` (the catalog is
  bidirectional; an uncataloged scenario fails `test:stories:contracts`).
- Flip the ledger record to `implemented`, with a rationale that names the residue left
  unproven within each closed dimension.
- Re-record the qualification baseline: every file above is a frozen compat input.

## Capabilities

### New Capabilities

None. `skip_specs: true`.

### Modified Capabilities

None. The governing requirement, `Ledger entries are evidence-bearing`
(`story-coverage-floor-qualification`), is **applied** here, not amended; the
per-denial-surface bar for `authorization-routing` is already recorded as a roadmap
convention and is deliberately not duplicated as a spec.

One production file does change, correcting an earlier claim in this proposal that there
would be none: `src/tools/core-capabilities.ts` gains
`'chat.participants.resolve': 'resolve_chat_participant'`. `CORE_TOOL_CAPABILITIES` is
pinned as an exhaustive ordered list, so the tool's absence was a gap in that map, not a
deliberate omission — and without an id the scripted story model cannot address the tool
at all, which blocks every `primary` scenario below. The addition is behavior-neutral:
`registerOfferedCoreToolCapabilities` registers a pair only when the wire tool is already
in the offered turn surface, and the catalog's sole consumer is
`runtime.resolveToolCapability`, whose sole caller is `tests/stories/harness/world.ts`.
`skip_specs: true` therefore still holds — no observable behavior and no requirement moves.

## Non-goals

- **Tier 1–4 coverage for this behavior.** Real-provider `resolveUserLabel` against
  Telegram/Discord/Mattermost/Kontur is a regression-lane concern and never gates a
  refactor qualification.
- **The p-limit bound and `computeScore` edge cases.** Unit-level and already covered;
  duplicating them pays frozen-input cost for nothing.
- **Any change to `roster.ts`, the tool descriptor, or the registration gate.** A defect a story reveals is a
  separate proposal, not a widening of this one.
- **The other six Phase 2 behaviors.** Each lands with its own change; seams attach to
  behaviors, not to a batch.

## Impact

- **Frozen inputs** — `tests/stories/**` changes, so the `d17459ee5` baseline retires
  and a new one is recorded on master.
- **Scope model** — group-context only; the resolver reads at the group-level config
  context id for members and the thread-scoped storage context id for senders. DM is a
  denial surface, not a supported path.
- **Docs** — the `behaviors.md` bullet is unchanged; the roadmap's open-dimension count
  drops from 14 to 12.

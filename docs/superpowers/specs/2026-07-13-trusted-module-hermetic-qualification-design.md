<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Trusted-module hermetic qualification

**Date:** 2026-07-13
**Status:** Approved design; awaiting specification review

## Goal

Establish a small, frozen Tier 0 story suite that proves the
`plugin-core-separation` refactor preserves production composition through the
new trusted-module architecture. The suite is a qualification gate for the
refactor, not a claim that the complete 126-record scenario catalog is already
covered.

## Scope

Phase 1 covers the new runtime seams introduced by trusted modules:

- startup ordering for trusted-module migrations, activation, and teardown;
- module tool registration, eligibility, and tool-gate enforcement;
- module command and prompt-fragment contribution assembly;
- ACP/coding-module session start through the existing strict fake Magi;
- coding/module settings mutation affecting a subsequent real chat turn; and
- world-to-world registry isolation.

The phase does not add broad task-provider, proactive, platform-adapter, or
nerv/supervision coverage. Those belong to subsequent catalog-family specs.

## Architecture

Every story uses the existing `ScenarioWorld` and production composition. It
must cross the same boundaries that production does:

```text
ScenarioWorld startup
  -> production runtime composition
  -> trusted-module migrations and activation
  -> module registry and eligibility
  -> module tool, command, and prompt assembly
  -> chat message, interaction, or settings request
  -> real persistence/reply plus sanitized fake-boundary event
```

Stories must not call a module registry or module tool directly to claim
end-to-end coverage. If a new fixture is needed, it supplies a trusted test
module through the same loader used by production and exposes only a stable
scenario setup operation.

## Required stories

1. An eligible context receives a trusted-module tool, the scripted LLM calls
   it through the real tool loop, and its expected persisted/event result is
   observed. An ineligible context never advertises that tool to the model and
   creates no side effect.
2. A trusted-module command and prompt fragment are present only in an eligible
   context. The command's user-visible response and the prompt fingerprint are
   both asserted.
3. The coding module starts an ACP session through fake Magi. Missing coding
   configuration, an operator/guest denial, and an upstream failure each leave
   no session record and consume no undesired request.
4. An authorized module settings descriptor mutation persists through the
   production settings route and changes the next chat turn. Unauthenticated,
   CSRF-less, malformed, or cross-context requests leave state unchanged.
5. Sequential fresh worlds run the module lifecycle safely and leave no module
   tool, command, prompt, eligibility, or gate registrations behind.

## Oracles and safety rules

Each story proves:

1. **User result:** a reply, command output, or HTTP response.
2. **Composition result:** offered contribution, fake Magi request, persisted
   coding/session/setting state, or migration marker.
3. **Safety result:** no mutation, request, capability advertisement, secret
   exposure, or registry leakage on the failure branch.

All external behavior remains hermetic: strict HTTP expectations, deterministic
clock/IDs, fake chat, scripted LLM, and no wall-clock waits. Existing I/O and
leak guards remain unchanged.

## Frozen-baseline qualification

The stories and all harness/runner inputs are authored and committed on the
hermetic baseline. `plugin-core-separation` then rebases on that baseline and
runs them without modifying frozen inputs. Compatibility mode is therefore
evidence that unchanged behavioral inputs pass against the refactored
production `src/` and `plugins/` tree.

Qualification requires:

```bash
BASE_REF=<hermetic-baseline-sha> bun test:stories:compat
bun test:stories:contracts
bun test:stories
bun test:stories:stress
bun test tests/architecture-guard.test.ts
bun test tests/composition/load-trusted-modules.test.ts
```

## Ledger and later phases

The catalog ledger moves a record to executable only once a literal `SCN-*`
story exists and its manifest reference resolves. Remaining records stay
pending with a concrete reason.

Subsequent independent specs cover:

1. task-tracker/provider capabilities, membership, provisioning, and YouTrack
   relocation;
2. ACP lifecycle, coding policy, MCP, and additional Magi failure paths;
3. settings/HTTP descriptor and route families;
4. commands, interactions, memory, deferred/proactive, and fetch families; and
5. nerv/supervision only when a real papai ingress and justified hermetic seam
   exist.

## Self-review

- The phase is limited to refactor-critical composition paths rather than
  conflating qualification with full catalog completion.
- It preserves the frozen-test compatibility model: tests do not migrate with
  the refactor being qualified.
- Each required story has a user, composition, and safety oracle.
- Later catalog work is explicitly deferred, not implied by Phase 1 success.

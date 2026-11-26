<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Pin plugin-manifest rejection identity

## Context

See proposal.md — Why. The measured evidence, from
`bun test:mutate:file src/plugins/types.ts` (report at
`reports/paired/src__plugins__types.ts.stryker-report.json`):

```
killed=80 survived=63 noCoverage=0 score=0.5594   floor 0.5725
```

Surviving mutants by kind: 26 `StringLiteral`, 15 `ArrayDeclaration`, 10
`ObjectLiteral`, 9 `Regex`, and one each of `EqualityOperator`,
`BooleanLiteral`, `ConditionalExpression`. They cluster into four groups:

1. **Refine identity (~40).** For each of the nine `.refine()` calls, the
   `message` string, the `path` array, and the options object itself all
   survive. `noCoverage=0` — the lines run, nothing asserts what they produce.
2. **Version regex (9).** Every `Regex` mutant plus the message literal.
3. **Declared defaults (~10).** `.default([])` array literals,
   `storageScope`'s `'context'`, `sensitive`'s `false`, and the
   `contributes` default object.
4. **The `providerConfigValidator` refine's own logic (2).** Its
   `EqualityOperator` and `ConditionalExpression` — only one arm is exercised.

## Goals / Non-Goals

Design-level boundaries beyond the proposal's Non-goals:

- **Goal:** assertions state a contract a plugin author depends on, and read as
  such. A reader who does not know Stryker exists should not be able to tell
  which assertion was prompted by a mutant.
- **Non-goal:** killing every survivor. Some may be equivalent mutants; group 4
  in particular may resist without contortion. The gate needs 82 of 143 killed;
  groups 1–3 clear it several times over.

## Decisions

### D1 — Assert error identity, not just rejection

Existing tests call the schema, check `success === false`, and stop. That is
why 40 mutants live: `message: ""` and `path: []` still fail the parse. The
tests will assert the specific issue — its `message` and its `path` — for each
refine.

Alternative considered: assert only that `message.length > 0`. Rejected — it
kills the `ObjectLiteral` mutants but not the `StringLiteral` ones, and more
importantly it pins nothing an author can rely on. A wrong-but-nonempty message
is the failure mode worth catching.

### D2 — One helper that returns the issue, not one assertion style per test

A small test-local helper — parse, expect failure, return the issues — keeps
each assertion to one line naming the message and path. Without it, every test
repeats the `success`/`issues` narrowing dance, and `max-lines-per-function`
becomes a real risk in a file gaining ~25 cases.

Alternative considered: `toThrow(/message/)` via `.parse()`. Rejected — it
cannot assert the `path`, which is half of what is unpinned.

### D3 — The two host allowlists get a negative cross-check

The spec requires that a key declared in `configRequirements` does not satisfy
`providerAllowedInstanceHostsFromConfig`, and vice versa. This is the one place
where the assertions guard a security boundary rather than a diagnostic:
instance-config values become operator-trusted hosts that bypass the https and
public-IP checks in `src/plugins/dynamic-hosts.ts`, while plugin-config hosts do
not. A refine that accepted the wrong schema's key would silently widen that
boundary, and today nothing would fail.

### D4 — Defaults are asserted on the parsed output, not the input type

`PluginManifest` (the hand-constructed type) marks defaulted fields optional,
so a type-level check proves nothing. The assertions read the parsed
`ParsedPluginManifest` value and compare it to the declared default. This is
also what makes the "not `undefined`" half of the requirement meaningful:
consumers such as `deriveInstanceHosts` iterate these arrays without a
null-guard.

### D5 — Existing suites are extended, not replaced

`tests/plugins/manifest-schema.test.ts` already owns schema-level parsing and
is the natural home. Where a rejection is already exercised in an adjacent
suite (`manifest-mcp.test.ts` for the MCP-only `main` rule), the identity
assertion is added there rather than duplicating the fixture. No new test file
is created unless `max-lines` forces a split — in which case the split is by
concern (rejection identity vs. defaults), not by mutant.

### D6 — No production change

Nothing in `src/` is edited. If an assertion cannot be written because the
current behavior is wrong, that is a finding to raise, not to fix here — the
proposal's Non-goals put message changes in a separate change.

## Risks / Trade-offs

- **Assertions pinned to exact message strings make future wording changes
  fail tests.** → That is the intent: the message is the contract. A reworded
  message is a deliberate edit to both sides, which is what review should see.
- **Equivalent mutants in group 4 may not be killable.** → The gate does not
  require them; if two resist after one honest attempt, leave them and say so
  rather than distorting a test to reach a number.
- **The baseline ratchets to the new, much higher score once master reseeds.**
  → Intended, and it is monotonic by design. The risk is only that a later
  change touching `types.ts` must keep the score; that is the ratchet working.
- **A large batch of new cases could trip `max-lines` on the test file.** → Split
  by concern per D5; the project rule treats the limit as a design signal, not
  something to compress around.

## Migration Plan

None — test-only change, no deployment surface, no rollback beyond reverting
the commit. The mutation baseline entry for `src/plugins/types.ts` reseeds from
master on the next `test:mutate:changed --update-baseline` run; no manual
baseline edit is needed or wanted.

## Open Questions

None.

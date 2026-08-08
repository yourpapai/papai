<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0358: Round Analytics `durationMs` at Emission and at the Subscriber Schema Boundary

## Status

Accepted

## Context

`tool_completed` analytics facts were being rejected by the normalizer with
`invalid_value` (issue #209). The root cause was a contract gap between the
subscriber and the normalizer:

- The LLM tool-call finish event carries `durationMs` as a raw float (e.g.
  `42.4`). The debug event `tool:analytics_completed` passed it through
  unchanged, so the subscriber emitted facts with non-integer durations.
- The normalizer validates `durationMs` with `nonNegativeInt`, so any float
  was rejected as `invalid_value`. Sibling emitters (`turn-observer.ts`,
  `provider-observer.ts`) already rounded durations with
  `Math.max(0, Math.round(...))`, but `llm-orchestrator-tool-events.ts` did
  not.
- The subscriber-side zod schemas (`ToolCompletedDataSchema`,
  `LlmErrorDataSchema`) declared `durationMs: z.number().nonnegative()` —
  accepting floats and forwarding them into the strict normalizer, widening
  the contract gap instead of closing it.

The system thus had two tolerance boundaries that disagreed: a permissive
subscriber and a strict normalizer, with floats leaking through the gap.

## Decision Drivers

- **Normalizer stays strict**: the fail-closed normalizer is the analytics
  integrity backstop (ADR-0341); making it tolerant of floats would weaken
  the contract for facts that bypass the subscriber.
- **Sibling convention**: `turn-observer.ts:74` and `provider-observer.ts:117`
  already round with `Math.max(0, Math.round(...))`; new code should match
  that convention rather than invent a new one.
- **Defense in depth at the boundary**: emission-side rounding fixes the
  known producer, but future emitters could reintroduce floats; the
  subscriber schema should guarantee int output regardless of input.
- **Mutation hygiene**: schema-side transform should contain no unkillable
  branches — `.nonnegative()` already rejects negatives, so a `Math.max(0, …)`
  clamp inside the transform would be dead code.
- **Raw float preserved for debugging**: `tool:execute_end` is a debugging
  surface, not analytics; it must keep the raw value so traces stay precise.

## Considered Options

### Option 1: Round at emission + rounding zod transform, normalizer unchanged (chosen)

- In `emitAnalyticsCompleted`
  (`src/llm-orchestrator-tool-events.ts:201`), emit
  `durationMs: Math.max(0, Math.round(event.durationMs))`; leave the
  `tool:execute_end` emit (`:228`) passing the raw float.
- Add a shared `DurationMs` schema
  (`src/analytics/subscriber-schemas.ts:19`):
  `z.number().nonnegative().transform((value) => Math.round(value))`, used
  for `durationMs` in both `LlmErrorDataSchema` and
  `ToolCompletedDataSchema`.
- Leave the normalizer's `nonNegativeInt` validation unchanged as a strict
  backstop for facts that bypass the subscriber.
- **Pros**: matches the existing sibling convention; closes the contract gap
  at both the producer and the boundary; normalizer strictness (and its
  rejection signal for genuinely malformed facts) is preserved; transform has
  no unkillable mutation branches.
- **Cons**: two rounding sites to keep conceptually aligned; NaN handling
  differs subtly (rejected by `.nonnegative()` rather than clamped).

### Option 2: Emission-side rounding only

Fix `emitAnalyticsCompleted` and leave the schemas as
`z.number().nonnegative()`.

- **Pros**: smallest diff; fixes the observed rejection stream.
- **Cons**: the subscriber schema still accepts floats, so any future emitter
  (or a mid-run steering/retry path) reintroduces the same
  `invalid_value` rejections. Rejected: the contract gap stays open.

### Option 3: Make the normalizer tolerant

Round floats inside the normalizer instead of rejecting them.

- **Pros**: single fix point; no emitter changes needed.
- **Cons**: weakens the fail-closed analytics contract for facts that bypass
  the subscriber; `invalid_value` rejections are a useful integrity signal
  that would silently disappear. Rejected: tolerance belongs at the boundary,
  strictness at the backstop.

## Decision

Adopt Option 1:

1. Round at the analytics emission site:
   `durationMs: Math.max(0, Math.round(event.durationMs))` in
   `emitAnalyticsCompleted`; the `tool:execute_end` debug payload keeps the
   raw float.
2. Add `DurationMs = z.number().nonnegative().transform((value) => Math.round(value))`
   and use it for `durationMs` in `LlmErrorDataSchema` and
   `ToolCompletedDataSchema`. `LlmEndDataSchema.totalDuration` stays
   `z.number().nonnegative()` — its only emitter produces integer
   `Date.now()` deltas (out of scope).
3. The normalizer stays strict and unchanged; a characterization test pins
   that a float `durationMs` fact bypassing the subscriber is still rejected
   `invalid_value`.

Deliberate spec deviation (mutation hygiene): the design spec sketched
`.transform(v => Math.max(0, Math.round(v)))`; the implementation uses
`.transform((value) => Math.round(value))` because `.nonnegative()` already
guarantees `value >= 0`, making the `Math.max` branch an unkillable mutant.
The emission site keeps the full `Math.max(0, Math.round(...))` because its
input is unvalidated.

## Rationale

- Boundary tolerance + backstop strictness is the established analytics
  posture: accept and normalize at the subscriber boundary, reject malformed
  facts at the normalizer. This decision aligns the subscriber with that
  posture instead of leaking floats through the gap.
- Rounding via a named shared schema (`DurationMs`) makes the contract
  explicit and reusable, and pins "half-up" rounding semantics in one place.
- Keeping `tool:execute_end` raw preserves debugging fidelity while the
  analytics twin (`tool:analytics_completed`) is int-guaranteed.

## Consequences

### Positive

- `tool_completed` / `invalid_value` normalization rejections from float
  durations stop; post-deploy verification is a single query against
  `analytics_normalization_rejections`.
- Subscriber output is int-guaranteed for `durationMs` regardless of emitter
  behavior; downstream readers (`src/analytics/subscriber.ts:127`, `:178`)
  are unchanged.
- The strict-normalizer contract is pinned by a characterization test, so a
  future "tolerant normalizer" change becomes a deliberate act.

### Negative

- Two rounding sites (emission + schema transform) must stay conceptually
  aligned; the schema transform is the durable guarantee, the emission clamp
  is producer hygiene.
- Rounding is half-up (`Math.round`); sub-millisecond precision is lost for
  analytics facts (acceptable — durations are aggregated, not traced).

### Risks

- A future emitter of `LlmEndDataSchema.totalDuration` with float durations
  would reintroduce the gap for that field.
  Mitigation: documented as out of scope; the schema name (`DurationMs`)
  provides an obvious conversion path if a non-integer emitter appears.
- Silent behavioral change for any test asserting raw float passthrough on
  `tool:analytics_completed`.
  Mitigation: the plan's tests explicitly pin the rounded analytics value and
  the raw `execute_end` value.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-02-tool-completed-durationms.md`;
  design spec:
  `docs/superpowers/specs/2026-08-02-tool-completed-durationms-design.md`;
  issue #209.
- Key sites: `src/llm-orchestrator-tool-events.ts:201` (rounding emit),
  `src/analytics/subscriber-schemas.ts:19` (`DurationMs`), applied at `:84`
  and `:100`.
- Regression tests: `tests/llm-orchestrator-tool-events.test.ts:242`,
  `tests/analytics/subscriber-schemas.test.ts:88`,
  `tests/analytics/subscriber.test.ts:219`, strict-backstop characterization
  test at `tests/analytics/normalizer.test.ts:466`.

## Related Decisions

- ADR-0341: Analytics Stage B readiness — establishes the fail-closed
  posture this decision preserves.
- ADR-0326: Content-free analytics pipeline staged rollout — defines the
  rejection-signal monitoring used for post-deploy verification.

## References

- Issue #209 (`tool_completed` facts rejected `invalid_value`)
- `docs/superpowers/specs/2026-08-02-tool-completed-durationms-design.md`

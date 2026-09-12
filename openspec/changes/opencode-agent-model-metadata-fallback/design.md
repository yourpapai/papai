<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Model metadata fallback for the agent pipeline

## Context

See `proposal.md` — Why. This change assumes
`opencode-agent-model-catalogue-provider` has landed: the provider id is a
configurable catalogue key, and OpenCode's own merge already covers every model
its catalogue carries. What is left is the tail — an id no catalogue knows —
and the tail is the pipeline's stated normal case, since `OpenAiSettings`
exists to point at "one arbitrary OpenAI-compatible endpoint".

Two existing facts shape the approach:

- `sdd-runner/src/pricing.ts` is already a models.dev client, and its own
  comments record why it is shaped the way it is (a parked-domain incident that
  made `loadDb` swallow a parse error and report every cost as unknown; a
  schema stricter than its consumer that rejected the whole database over one
  unpriced model). Both lessons apply verbatim to a metadata reader.
- `opencode-agent/CLAUDE.md` states the workspace imports nothing from papai's
  `src/`, and `opencode-agent-openspec-compliance` recorded that `sdd-runner`'s
  idioms are reused "as patterns, not imported as code". That precedent is
  about *process idioms*; this is a hundred lines of HTTP-and-cache that the
  minimality ladder says must not be written twice.

## Goals / Non-Goals

**Goals:**

- A non-zero `limit.context` for any model an operator can name, by catalogue
  or by hand.
- One source of models.dev truth in this repository.
- A boot path that is never made slower or more fragile by the lookup.

**Non-Goals:**

- Cost (see proposal — Non-goals; S5-6).
- papai's runtime `src/model-context.ts`.
- Choosing effort or per-phase models.

## Decisions

### D1 — Widen `pricing.ts`, do not fork it

`sdd-runner/src/pricing.ts` grows a `lookupModel(modelId)` returning the parsed
catalogue entry; `resolveCost` becomes a caller of it. `opencode-agent`
imports that one function.

*Alternative considered — a second reader inside `opencode-agent/`.* Rejected
by the minimality ladder ("is it already in this codebase"): it would duplicate
the cache, the bound, the schema and both recorded incident fixes, and the
second copy would be the one that silently rots.

*Alternative considered — extract a fourth shared workspace.* Rejected as
premature: two consumers do not justify a new package boundary, and the design
rule to name the existing module before introducing a new one points at
`pricing.ts`. If a third consumer appears (papai's `src/model-context.ts` is
the obvious candidate) the extraction is the right move then, with three call
sites to shape it.

*Consequence accepted:* `opencode-agent` gains one import from another
workspace. It is one-directional, one function wide, and both are dev tooling
outside papai's runtime.

### D2 — Schema stays looser than the consumer

`ModelEntrySchema` currently makes `cost` optional because 419 published
entries have none, and requiring it once rejected the entire database. Every
field this change reads (`limit`, `reasoning`, `tool_call`, `temperature`,
`attachment`) is optional for the same reason and must stay so: a single entry
missing `limit` must not cost the lookup its other 1,800 rows.

### D3 — A stated precedence, most explicit first

```
AGENT_MODEL_CONTEXT / _OUTPUT / _REASONING   operator said so → always wins
        ↓ (unset)
models.dev lookup of <LLM_PROVIDER>/<LLM_MODEL>
        ↓ (miss, or fetch failed)
OpenCode's own catalogue merge               ← change 1 makes this reachable
        ↓ (miss)
today's zero defaults                        ← compaction off, no variants
```

Emitting a field only when a tier resolves it is what keeps the bottom rung
reachable: writing `limit: { context: 0 }` explicitly would *pin* the broken
value instead of leaving OpenCode's merge free to fill it.

### D4 — Best-effort, bounded, and loud in the log

The lookup runs once on the boot path, inside the existing fetch bound, and any
failure — unreachable host, HTML from a parked domain, a schema miss — is a
`warn` naming what degraded plus a fall to the next tier. It never throws into
`runCli`. The workspace's own rule that "best-effort" must be a property of one
function rather than a convention at each call site applies: exactly one
function may swallow, and it returns `null`.

The resolved values are logged at `debug` on boot — provider, model,
`limit.context`, `reasoning`, and *which tier supplied them*. A run's log
should answer "why did this not compact" without a rerun.

### D5 — Range-checked overrides

`AGENT_MODEL_CONTEXT` and `AGENT_MODEL_OUTPUT` go through `boundedInt` with
ranges chosen so a value that cannot work is refused at load: a context window
below a single phase's prompt budget is a run that compacts on every turn, and
an output cap above OpenCode's own `OUTPUT_TOKEN_MAX` (32,000) is silently
clamped anyway. `AGENT_MODEL_REASONING` is a boolean knob in the same style.

## Risks / Trade-offs

- **A new outbound host on the boot path.** → Mitigation: bounded, cached,
  best-effort (D4); a failure is indistinguishable from today's behavior.
  `bun security` covers the fetch surface, and the URL is a pinned constant
  with a test holding the domain — the incident `pricing.ts` already records.
- **Cross-workspace import (D1).** → Mitigation: one function, one direction,
  both dev tooling. Revisit at the third consumer.
- **models.dev disagrees with the endpoint.** A gateway may truncate context
  below the catalogue row. → Mitigation: D3's top tier is an explicit override
  that wins, and D4's log says which tier answered.
- **Trade-off: three more env vars.** Accepted — they are the only answer for a
  model no catalogue can know, and they are inert when unset.

## Migration Plan

Additive; every tier below the new ones is today's behavior. Rollback is
reverting the splice — the widened `pricing.ts` is backward compatible on its
own.

## Open Questions

None that would change the approach or the task breakdown.

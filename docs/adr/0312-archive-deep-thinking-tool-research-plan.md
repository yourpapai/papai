<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0312: Archive the Deep-Thinking Tool Research Plan — Defer the `ask_llm` Feature

## Status

Accepted

## Date

2026-08-07

## Context

`docs/superpowers/plans/2026-04-03-deep-thinking-tool-research.md` is a
research-only plan (~310 lines) whose entire scope is to *produce another plan*.
Its goal is to assess the feasibility, design options, and trade-offs of adding
an `ask_llm` ("deep-thinking") tool that forwards a user's general-knowledge
question to a larger/more capable model when the bot's `main_model` cannot answer
well enough. The plan explicitly states "no implementation" — its sole deliverable
is a design document at `docs/plans/YYYY-MM-DD-deep-thinking-tool-design.md`
containing a problem statement, approach-comparison table, recommended approach,
and config-key / system-prompt / tool-schema / error-handling / testing strategy.

A codebase verification against the current tree (2026-08-07) found the plan
**not implemented**:

- **0/8 on the Research Sources Checklist.** All eight items remain unchecked
  (Vercel AI SDK nested `generateText` in a tool `execute`;
  `@ai-sdk/openai-compatible` provider options; OpenAI reasoning-model
  differences o1/o3/o4-mini; Anthropic extended thinking; open-source
  model-routing bots; papai `small_model` usage pattern; papai tool-definition
  patterns; multi-model prompt-injection research).
- **None of Tasks 1–7 were executed** (problem-space definition, routing-pattern
  research, config-key evaluation, tool-schema options A/B/C, security analysis,
  UX/system-prompt implications, capability-gating strategy).
- **The Task 8 deliverable does not exist.** No
  `docs/plans/*deep-thinking*` file is present anywhere under `docs/`
  (the only match is the plan itself).
- **No related code or OpenSpec change exists.** `src/` contains no
  `ask_llm` / `thinking_model` / `askLlm` / `thinkingModel` references; this is
  expected for a research-only plan but confirms nothing downstream of it landed.
- **The plan is not marked superseded** and no conflicting/replacement plan
  exists.

The referenced papai code patterns the research depends on (`main_model` /
`small_model` / `embedding_model` config, `makeTools()` / `addMemoTools()`
tool assembly, standalone LLM tools like `save_memo` / `save_instruction`) are
present in `src/` as study input, so a future re-entry is not blocked by missing
grounding code.

## Decision Drivers

- **The remaining work produces no shippable value.** It is research-to-plan:
  eight external surveys plus seven analysis tasks whose only output is another
  planning document, not a working `ask_llm` tool. The feature itself stays
  unbuilt either way.
- **The research content decays fast.** The bulk of the survey — OpenAI
  o-series / Anthropic extended-thinking / Gemini thinking / DeepSeek R1 API
  differences, and Vercel AI SDK nested-`generateText` behavior — turns over in
  months. A design doc written in 2026-Q3 against early-2026 model APIs would
  itself be stale within a release or two.
- **The planning workflow has moved to OpenSpec.** Per `AGENTS.md` (Pi
  Workflow), code-behavior work now enters through `/opsx:explore` /
  `/opsx:propose` under `openspec/changes/<name>/`, and an OpenSpec proposal
  carries its own `design.md`. The standalone design-doc deliverable this plan
  targets duplicates that step under a retired location (`docs/plans/`).
- **No demonstrated demand.** The plan is ~4 months old (2026-04-03) with zero
  checklist activity and no requesting user; the `ask_llm` feature is
  speculative.
- **The plan lives in a legacy corpus under triage.** `docs/superpowers/plans/`
  is already slated for migration per
  `docs/operations/legacy-migration-runbook.md`; leaving an un-actioned
  research plan on the active shelf invites future effort against a target that
  no longer matches the repo's planning model.
- **Stale plans mislead.** An open, 0/8 research plan presents as actionable
  backlog even though nothing in it has been touched in four months.

## Considered Options

### Option 1 — Archive the plan; re-enter via OpenSpec if the feature is requested (chosen)

Mark the plan superseded and relocate it off the active plans shelf (e.g. to
`docs/archive/`) with a superseded marker and a pointer to this ADR. If the
`ask_llm` / deep-thinking feature is ever genuinely requested, re-enter through
`/opsx:explore` / `/opsx:propose` under `openspec/changes/<name>/`, where the
proposal's own `design.md` absorbs the research this plan would have produced,
grounded in the current `small_model` / tool-assembly conventions rather than
the retired `docs/plans/` location.

- **Pros:** stops effort bleeding into meta-research with no product payoff;
  removes a misleading shelf entry; avoids duplicating OpenSpec's design step;
  the task descriptions are preserved in the archived plan as input for any
  future proposal.
- **Cons:** the `ask_llm` feature remains unbuilt and the design doc never
  lands; if the feature is later requested, the design exploration restarts from
  scratch (though against fresher model APIs).

### Option 2 — Complete the research and write the design doc as written (rejected)

Execute the Research Sources Checklist, work through Tasks 1–7, and produce
`docs/plans/YYYY-MM-DD-deep-thinking-tool-design.md` exactly as the plan
specifies.

- **Pros:** fully specified task list already exists; produces a tangible
  deliverable.
- **Cons:** medium effort for low worthiness — the output is a second planning
  document, not a feature; the external-API survey content decays within months;
  the `docs/plans/` deliverable duplicates what an OpenSpec proposal's
  `design.md` would carry; no user has asked for the feature.

### Option 3 — Skip research; implement an MVP `ask_llm` tool directly now (rejected)

Bypass the design doc and ship the MVP approach the plan pre-judges as most
likely (single `thinking_model` config key reusing `llm_apikey` /
`llm_baseurl`, minimal schema, LLM-decided routing).

- **Pros:** ships a working feature instead of a document.
- **Cons:** builds a speculative, unrequested feature on top of fast-moving
  reasoning-model APIs without validating demand, security (prompt-injection in
  the second model, runaway cost), or UX (30–120s latency, error fallback).
  Premature; should be driven by a real request entering through OpenSpec, not
  by executing a stale plan.

## Decision

**Archive the plan. Do not implement it — neither the research nor the feature.**

1. **Mark the plan superseded** and relocate it from the active
   `docs/superpowers/plans/` shelf (e.g. to `docs/archive/`), with a superseded
   marker and a pointer to this ADR, so it no longer presents as actionable
   backlog.
2. **Do not write `docs/plans/YYYY-MM-DD-deep-thinking-tool-design.md`.** The
   `docs/plans/` deliverable location is retired; design work belongs in an
   OpenSpec proposal's `design.md` if the feature is ever pursued.
3. **Do not add `ask_llm`, `thinking_model`, or related config/code now.** No
   `ask_llm` tool, `thinking_model` config key, or capability gating is to be
   introduced on the basis of this plan.
4. **Re-route through OpenSpec if the feature is later requested.** Any future
   deep-thinking / `ask_llm` work enters through `/opsx:explore` /
   `/opsx:propose` under `openspec/changes/<name>/`, treating this plan's task
   descriptions (problem space, config-key options A/B/C, tool-schema options,
   security findings, capability-gating options) as **input**, not as a
   contract — and grounded in the then-current reasoning-model landscape, not
   early-2026 APIs.

## Consequences

### Positive

- A medium-effort, low-worthiness meta-research effort is removed from the
  actionable backlog.
- The active plans shelf no longer carries a 4-month-stale, 0/8 research target.
- No time is spent producing a `docs/plans/` design doc that duplicates
  OpenSpec's `design.md` step under a retired location.
- The plan's analysis scaffold (scenarios, option tables, security prompts) is
  preserved in the archived copy as input for any future OpenSpec proposal.

### Negative

- The `ask_llm` / deep-thinking feature remains unbuilt, and no design document
  for it exists.
- If the feature is later requested, the design exploration restarts from
  scratch rather than building on a completed design doc.

### Risks

- **Future agents rediscover the stale plan and treat it as actionable.**
  Mitigation: the plan's relocated copy and this ADR both carry the superseded
  marker and a pointer here.
- **The feature becomes genuinely needed and the deferral cost looks
  unjustified.** Mitigation: re-entry through `/opsx:propose` is one step and
  will benefit from fresher reasoning-model APIs than this plan's 2026-Q1
  survey would have captured.
- **The plan's research scaffold is lost.** Mitigation: the plan is relocated,
  not deleted; its task descriptions remain available as OpenSpec input.

## Related Decisions

- **ADR-0309** — Archive the Phase 10 Notification Controls Plan;
  **ADR-0310** — Archive the Preprocessing Classifier Plan;
  **ADR-0311** — Archive the Layered Architecture Violations Fix Plan:
  the precedent for archiving a stale / superseded / low-worthiness plan with an
  ADR rather than executing it.
- **OpenSpec migration** (`AGENTS.md` Pi Workflow; see also the
  `migrate-brainstorming-to-openspec` and `legacy-corpus-porting-procedure`
  changes under `openspec/changes/`): establishes that code-behavior design now
  lives in OpenSpec proposals, which is what makes this plan's
  `docs/plans/` design-doc deliverable redundant.

## References

- Plan: `docs/superpowers/plans/2026-04-03-deep-thinking-tool-research.md`
  (research-only; sole deliverable
  `docs/plans/YYYY-MM-DD-deep-thinking-tool-design.md`).
- Triage basis: `docs/operations/legacy-migration-runbook.md`
  (`docs/superpowers/` → OpenSpec lanes).
- Workflow basis: `AGENTS.md` (Pi Workflow — code-behavior work enters via
  `/opsx:explore` / `/opsx:propose` under `openspec/changes/<name>/`).
- Codebase verification (2026-08-07): Research Sources Checklist 0/8; Tasks 1–8
  not executed; no `docs/plans/*deep-thinking*` file; no
  `ask_llm` / `thinking_model` / `askLlm` / `thinkingModel` references in
  `src/`; no related OpenSpec change; plan not marked superseded.

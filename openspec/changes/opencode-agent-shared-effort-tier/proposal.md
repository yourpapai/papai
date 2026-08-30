# Shared effort tier + effort on the review loop's claude subprocesses

## Goal

Two things the maintainer asked for on issue #388:

1. **Gap 1 — the review loop's `claude` subprocesses drop the effort tier.** On the `opencode` route the loop's workers inherit `agent.build.variant` through `OPENCODE_CONFIG_CONTENT`; on the `claude` route `review-loop/src/agent-command.ts` composes argv with `--allowedTools` and `--model` but never `--effort`. That contradicts `opencode-agent/README.md:1841`, which states `AGENT_EFFORT_BUILD` covers "the review loop's ... workers" with no backend caveat. The two backends must agree.
2. **A project-level shared effort variable.** Today the only tiers are the two per-profile ones, and `propose` has no effort knob at all (`claude-argv.ts:127` hardcodes `effort: null`; `openai-config.ts:250` emits no `variant` for `propose`). Add one `AGENT_EFFORT` repo variable that sets the tier for *all* phases, with the per-profile variables overriding it.

Unset everything and the emitted OpenCode config and claude argv must stay byte-identical to today.

## Assumptions (stated rather than asked)

- "All phases" is read as all three agent profiles — `plan`, `propose`, `build`. Wiring `propose` is therefore in scope, since a shared variable that silently skipped a phase would be the wrong knob. `AGENT_EFFORT_PROPOSE` is added alongside it so the per-profile override set stays symmetric — same four touch points, no extra design.
- Precedence is per-profile-wins: `AGENT_EFFORT_<PROFILE>` when set, else `AGENT_EFFORT`, else nothing emitted (`null` → no `variant` key, no `--effort` flag). No merging, no "max of" logic.
- `AGENT_EFFORT` gets the same validation as the existing tiers — the deliberate *shape* check in `config-model-values.ts:67-104` (lowercase, ≤16 chars, `^[a-z][a-z0-9-]*$`), not an enum. Do not introduce a hardcoded tier list; the comment there explains why the valid set is model-dependent.
- Gap 3 (per-phase rather than per-profile granularity) and gap 4 (manual verification of tasks 3.1–3.5 on `opencode-agent-per-phase-model-params`) are **not** in scope.
- The review-loop config's new effort field is consumed only by the claude branch. The opencode branch already carries the tier in `OPENCODE_CONFIG_CONTENT`; do not also append it to `opencode run` argv.

## Files to touch

**Shared / propose effort (opencode-agent)**

- `.github/workflows/agent-pipeline.yml` — forward `AGENT_EFFORT` and `AGENT_EFFORT_PROPOSE` beside the existing pair at `:529-530`, with a comment saying `AGENT_EFFORT` is the project-level default the per-profile ones override.
- `opencode-agent/src/config.ts:101-105` — read `AGENT_EFFORT` once and resolve the three profile tiers against it.
- `opencode-agent/src/openai-config.ts` — `ModelProfiles` (`:41-56`) gains `proposeEffort`; `NO_MODEL_PROFILES` gains its `null`; `agentProfiles` (`:250`) emits `variant: profiles.proposeEffort` on `propose`.
- `opencode-agent/src/contain.ts:162-165` — carry `proposeEffort` onto `ClaudeModelKnobs`.
- `opencode-agent/src/claude-argv.ts` — `ClaudeModelKnobs` gains `proposeEffort`; `profileSelection` (`:127`) returns it for `propose` instead of `null`.

**Gap 1 (review loop)**

- `review-loop/src/config.ts` — `AgentConfigSchema` gains an optional `effort` string (same shape check, so a bad value is refused at config load rather than at spawn).
- `review-loop/src/agent-command.ts` — `AgentCommandOptions` gains `effort?: string`; `claudeCommand` (`:207-226`) appends `'--effort', effort` next to `--model`, mirroring `opencode-agent/src/claude-argv.ts:189`. `opencodeCommand` ignores it.
- `review-loop/src/agent-runner.ts` — `RunAgentOptions` gains `effort`, passed through `attemptRun` at `:135`.
- The role call sites that build `RunAgentOptions` from their role config: `review-round.ts:104,145`, `issue-processor-attempts.ts:57`, `issue-processor-batch.ts:113`, `issue-matcher.ts`, `issue-inspector.ts`. All four roles get the same tier — matching the opencode route, where every worker resolves to the primary `build` agent.
- `opencode-agent/src/review-runner.ts:88-92` — the claude branch of the role `agent` object sets `effort: settings.openai.profiles?.buildEffort ?? null`.

**Docs**

- `opencode-agent/README.md` — env table (`:1655-1656`) gains `AGENT_EFFORT` and `AGENT_EFFORT_PROPOSE` with the precedence rule; the profile table (`:1837-1841`) gains the `propose` tier and drops the now-false backend caveat implied at `:1841`; the claude-route note (`:2113-2115`) records that the review loop's claude subprocesses now carry `--effort` too.
- `opencode-agent/CLAUDE.md:664-668` — one line on the shared variable and its precedence.

## Behaviour change

| Variables set | plan | propose | build | review-loop claude workers |
| --- | --- | --- | --- | --- |
| none | (unset) | (unset) | (unset) | no `--effort` |
| `AGENT_EFFORT=high` | high | high | high | `--effort high` |
| `AGENT_EFFORT=high`, `AGENT_EFFORT_PLAN=low` | low | high | high | `--effort high` |
| `AGENT_EFFORT_BUILD=xhigh` only | (unset) | (unset) | xhigh | `--effort xhigh` |

On the opencode route a resolved tier is emitted as `agent.<profile>.variant`; on the claude route as `--effort <tier>` on the phase turn and — new — on every review-loop role subprocess. Note the pre-existing gate that is *not* changing: on the opencode route the effort variants are emptied when the catalogue row's `reasoning` capability is false (`openai-config.ts:118-133`), so a tier can be set correctly and still be discarded because of `LLM_PROVIDER`.

## Verification

- `tests/opencode-agent/config.test.ts` — `AGENT_EFFORT` alone populates all three tiers; a per-profile variable overrides it; unset leaves all three `null`; an invalid `AGENT_EFFORT` raises `ConfigError` naming the key.
- `tests/opencode-agent/openai-config.test.ts` — `propose` carries `variant` when a tier resolves, and the emitted config has no `variant` key anywhere when none does.
- `tests/opencode-agent/claude-adapter.test.ts` / `provider-proxy.test.ts` — a `propose` turn emits `--effort`; the `ClaudeModelKnobs` fixtures gain the new field.
- `tests/review-loop/agent-command.test.ts` — the claude branch emits `--effort <tier>` adjacent to `--model`, emits nothing when the field is absent, and the opencode branch's argv is unchanged in both cases.
- A review-runner test asserting the role config the pipeline writes carries `buildEffort` on the claude backend and is unaffected on the opencode one.
- `bun check:full` (lint, typecheck, tests) green; the workflow YAML parses.

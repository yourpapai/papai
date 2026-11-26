# Design — shared effort tier + effort on the review loop's claude subprocesses

## Context

See `proposal.md` — Goal, for why. The state that shapes the approach:

- **One carrier already exists.** `ModelProfiles` (`opencode-agent/src/openai-config.ts:41-56`) holds `light`, `planEffort`, `buildEffort` and rides `OpenAiSettings`, which both execution routes read: the opencode route emits `agent.<profile>.variant` (`openai-config.ts:250`), the claude route reads the same fields through `ClaudeModelKnobs` (`contain.ts:162-165` → `claude-argv.ts:127`). Nothing new is needed to carry a third tier.
- **One parser already exists.** `effortTier` (`config-model-values.ts:67-104`) is a deliberate *shape* check — lowercase, ≤16 chars, `^[a-z][a-z0-9-]*$` — with a comment explaining why the valid set cannot be enumerated here.
- **The two workspaces do not compile against each other.** `review-loop/src/claude-argv.ts:11-15` states the doctrine: claude-CLI argv facts are duplicated across the subprocess boundary, never imported, and pinned equal by `tests/opencode-agent/claude-doctrine.test.ts`. Its `:62` case asserts the loop's argv tail equals `buildClaudeArgv`'s — so any argv change lands on both sides or breaks the pin.
- **The review loop's role configs are per-role objects.** `AgentConfigSchema` (`review-loop/src/config.ts:23-37`) already carries `model`, `backend`, `extraArgs`, `timeoutMs` per role; `opencode-agent/src/review-runner.ts:88-92` writes the same object for every role.

## Goals / Non-Goals

**Goals**

- One resolution point for the precedence rule, so the two backends cannot disagree about which tier a profile got.
- Additive-only wire format: with every variable unset, the emitted OpenCode config and both argv compositions are byte-identical to today.
- A bad tier is refused at config load, in both workspaces, before any subprocess spawns.

**Non-Goals**

- Enumerating valid tiers, normalising them, or mapping between backends' spellings. The tier string crosses verbatim; the model refuses what it does not accept.
- Changing the pre-existing opencode-route gate that empties effort variants when the catalogue row's `reasoning` is false (`openai-config.ts:118-133`).
- Per-phase (as opposed to per-profile) granularity, and any change to the loop's own role→backend resolution.

## Decisions

**D1 — Resolve precedence once, at config load, into `ModelProfiles`.**
`opencode-agent/src/config.ts:101-105` reads `AGENT_EFFORT` once and folds it into the three profile fields (`AGENT_EFFORT_<PROFILE> ?? AGENT_EFFORT ?? null`). Downstream nothing knows a shared variable exists — `openai-config.ts`, `contain.ts` and `claude-argv.ts` keep reading a resolved `string | null` per profile.
*Alternative:* keep `shared` as a fourth field and let each emit site fall back to it. Rejected — three emit sites across two routes would each re-derive the same rule, which is exactly the class of drift that produced Gap 1.

**D2 — Reuse `effortTier` for `AGENT_EFFORT`; introduce no new module and no tier enum.**
The need is already covered by `config-model-values.ts`; no new module is warranted. An enum is rejected for the reason recorded in that file's own comment: the valid set is model- and release-date-dependent, so a hardcoded list would reject tiers that work.
*Trade-off accepted, unchanged from today:* a semantically-wrong-but-well-shaped tier surfaces at the first prompt, not at load.

**D3 — Three named fields on `ModelProfiles`, not a profile-keyed map.**
`proposeEffort` joins `planEffort`/`buildEffort`, and `NO_MODEL_PROFILES` gains its `null`.
*Alternative:* `Record<ProfileName, string | null>`. Rejected — it rewrites every fixture, `contain.ts`'s knob assembly and `claude-argv.ts`'s `profileSelection` for no behaviour the change claims, and the two-field shape it replaces is only one field short of the map anyway.

**D4 — The review loop carries the tier per role, as an optional `effort` on `AgentConfigSchema`.**
It rides beside `model` and `backend` because it is the same kind of fact and reaches `buildAgentCommand` through the same object; every call site already destructures a role config, so no new plumbing appears.
*Alternative:* a top-level `effort` on `ReviewLoopConfigShape`. Rejected — `agent-command.ts` receives the role's options, not the whole config, so a top-level field would need threading through `review-round.ts`, `issue-processor-*.ts`, `issue-matcher.ts` and `issue-inspector.ts` regardless, while being inconsistent with how `model` already travels. Per-role also does not foreclose the out-of-scope per-phase work.
`opencode-agent/src/review-runner.ts:88-92` writes `buildEffort` onto every role on the claude backend — matching the opencode route, where every loop worker resolves to the primary `build` agent (`openai-config.ts:250`'s comment).

**D5 — Duplicate the shape check into review-loop as a Zod refinement rather than importing it.**
This is the documented boundary from `review-loop/src/claude-argv.ts:11-15`: the workspaces do not compile against each other. Zod covers the need — no new dependency. The duplication is deliberate and small (one length bound, one pattern); the doctrine test is the place to pin it equal if the pattern is ever loosened.

**D6 — `--effort` goes immediately after `--model` on both sides; the opencode branch ignores the field.**
Same position keeps `tests/opencode-agent/claude-doctrine.test.ts:62`'s tail pin meaningful and lets it be extended to the tier-set case rather than weakened. `opencodeCommand` drops `effort` on the floor: on that route the tier already reaches the worker as `agent.build.variant` inside `OPENCODE_CONFIG_CONTENT`, and appending it to argv would create a second source of truth for the same setting.

**D7 — `propose` gets a tier because a "shared" variable that silently skipped a phase would be the wrong knob.**
`claude-argv.ts:127` stops returning a hardcoded `null`; `openai-config.ts:250`'s `propose` profile gains `variant`. `AGENT_EFFORT_PROPOSE` ships alongside so the per-profile override set stays symmetric — the same four touch points, no extra design.

**Gating, scope and storage — explicitly nothing new.**
No new tool surface: allowlists (`ALLOWLISTS`, `allowlistForLabel`), `--allowedTools`, MCP grants and the capability/tool-prefs gating are untouched; a tier changes how hard a model thinks, never what it may call. No new persisted state, so no scope keys (storage context, config context, platform instance, user) are involved: the tier is a per-run environment value that lives in the in-memory `OpenAiSettings` and in the run-scoped review-loop config JSON under the job work dir, and outlives nothing. No DB tables and therefore no drizzle migration or backfill. No new dependencies — Zod covers the loop-side validation, the existing `effortTier` covers the pipeline side.

## Risks / Trade-offs

- **A tier resolves correctly and is still discarded on the opencode route** when the catalogue row for `LLM_PROVIDER` has `reasoning: false` (`openai-config.ts:118-133`) → pre-existing and unchanged; recorded in the README's env table so the operator can read why nothing happened, rather than being surprised by it.
- **`--effort` now reaches every review-loop role subprocess, not just phase turns** — a tier a model rejects fails four roles instead of one → the flag is emitted only when a tier resolves, so the unset default is byte-identical; the load-time shape check catches malformed values in both workspaces; the blast radius is the tier the operator asked for, applied consistently.
- **The doctrine pin can silently narrow** if `--effort` is added to only one side of the boundary → the tail-equality case is extended to cover a set tier on both sides, so a one-sided change fails the test rather than degrading the route.
- **`propose` turns become effort-carrying for the first time**, so a repo that sets `AGENT_EFFORT` changes cost on a phase that previously had no knob → intended (D7), stated in the proposal's behaviour table, and reversible by setting `AGENT_EFFORT_PROPOSE` to a lower tier.
- **Duplicated validation drifts** from `effortTier` (D5) → the bound and pattern are small and the doctrine test is the existing mechanism for pinning cross-workspace constants equal.
- **The workflow edit cannot be applied by this pipeline.** Forwarding `AGENT_EFFORT` and `AGENT_EFFORT_PROPOSE` in `.github/workflows/agent-pipeline.yml` (beside the existing pair at `:529-530`) touches `.github/workflows/`, which the agent's token cannot push → the apply phase must complete every other file and hand the maintainer the two `env:` lines to add by hand. Until they are added, the variables are simply absent from the job env and behaviour stays at today's default; nothing half-applies.

## Migration Plan

No data migration and no schema change — the whole surface is environment variables plus an optional config field.

1. Land the code and docs; default behaviour is unchanged with every variable unset.
2. Maintainer adds the two `env:` forwarding lines to `.github/workflows/agent-pipeline.yml` (see the last risk).
3. Operators opt in by setting the `AGENT_EFFORT` repo variable; per-profile variables continue to win where already set.

**Rollback:** unset the repository variables — the resolved tiers return to `null`, no `variant` key is emitted and no `--effort` flag is composed, which is the pre-change wire format exactly. A code revert is only needed if the field plumbing itself is at fault.

## Hook / TDD interactions

The change adds no new files, so the Write/Edit pipeline's `enforce-write-policy` (protected lint config, inline suppressions) is not engaged, and `tdd-nudge` fires only where an edited gateable impl file has no covering test — every file here already has one. `verify-test-import` applies to the test files touched.

Test-first order, per file group:

1. `tests/opencode-agent/config.test.ts` — precedence and the `ConfigError` naming `AGENT_EFFORT` → then `config.ts`.
2. `tests/opencode-agent/openai-config.test.ts` — `propose` carries `variant`; no `variant` key anywhere when nothing resolves → then `openai-config.ts`.
3. `tests/opencode-agent/claude-adapter.test.ts` (and the `ClaudeModelKnobs` fixtures, including `claude-doctrine.test.ts:62`'s) — a `propose` turn emits `--effort` → then `contain.ts` and `claude-argv.ts`.
4. `tests/review-loop/agent-command.test.ts` — claude branch emits `--effort` adjacent to `--model`, emits nothing when absent, opencode argv unchanged in both cases → then `review-loop/src/config.ts`, `agent-command.ts`, `agent-runner.ts` and the role call sites.
5. `tests/opencode-agent/review-runner.test.ts` — the written role config carries `buildEffort` on the claude backend and is unaffected on the opencode one → then `review-runner.ts`.
6. Docs last, once the behaviour they describe is green.

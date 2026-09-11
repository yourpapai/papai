<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Models-dev catalogue layer

- [x] 1.1 TDD red: extend `tests/models-dev/client.test.ts` — the parse keeps `reasoning` (boolean) and `reasoning_options` tolerantly: effort-kind values kept as strings in catalogue order, null entries inside `values` dropped, non-string values dropped, `kind: 'budget'` ignored, malformed/mismatched shapes leave the fields absent without failing the parse. Verify: `bun test tests/models-dev/client.test.ts` (fails)
- [x] 1.2 Implement the tolerant schemas in `src/models-dev/client.ts` in the file's existing `.optional().catch(undefined)` style. Verify: `bun test tests/models-dev/`
- [x] 1.3 TDD red: extend `tests/models-dev/resolve.test.ts` — `ModelMetadata` gains additive optional `reasoning`/`effortLevels`; catalogue effort entries thread through the override and inferred paths; an ambiguous model name with disagreeing level lists resolves `effortLevels: null`; existing `ModelMetadata` literals stay valid. Verify: `bun test tests/models-dev/resolve.test.ts` (fails)
- [x] 1.4 Implement the metadata threading and the levels agreement rule mirroring the context-window agreement in `src/models-dev/resolve.ts`. Verify: `bun test tests/models-dev/` && `bun run typecheck`
- [x] 1.5 TDD red: new `tests/models-dev/effort-levels.test.ts` — `effortLevelsFor` matrix: catalogue effort entry → those values verbatim in catalogue order; `reasoning === false` → empty set; unknown/ambiguous/absent → the union `none, minimal, low, medium, high, xhigh, max` in effort-ascending order; set-membership helper. Verify: `bun test tests/models-dev/effort-levels.test.ts` (fails)
- [x] 1.6 Implement the pure module `src/models-dev/effort-levels.ts` (union constant, `effortLevelsFor`, membership). Verify: `bun test tests/models-dev/effort-levels.test.ts`

## 2. Config key and request gate

- [x] 2.1 TDD red: extend `tests/ai-output-settings.test.ts` — free-string parse (`'default'`/empty/unknown → `null`, never coerced to a level) and the `resolveEffectiveReasoningEffort(configContextId, metadata)` gate (stored value in the model's current set → that value; out-of-set after a model switch → `null`). Verify: `bun test tests/ai-output-settings.test.ts` (fails)
- [x] 2.2 Add `ai_reasoning_effort` to `AiOutputConfigKey`/`ALL_CONFIG_KEYS` (src/types/config.ts) and implement the parser plus gate in `src/ai-output-settings.ts`. Verify: `bun test tests/ai-output-settings.test.ts`

## 3. Settings surface (fields, routes, UI)

- [x] 3.1 TDD red: extend `tests/config-keys.test.ts` — the `ai_reasoning_effort` select field's options are derived per active model through the LLM config resolution: catalogue levels / union fallback for unknown or unconfigured / default-only for a catalogue non-reasoning model; the other AI-output fields are returned unchanged without mutating the shared constants. Verify: `bun test tests/config-keys.test.ts` (fails)
- [x] 3.2 Implement the field entry and per-model option decoration in `src/config-keys.ts`. Verify: `bun test tests/config-keys.test.ts`
- [x] 3.3 TDD red: extend `tests/debug/settings/config-routes.test.ts` — GET returns the derived options for the context's active model; PATCH stores a union value while the active model is catalogue-unknown; PATCH rejects a clearly invalid value with 422 listing the allowed set; unsetting (empty) is accepted. Verify: `bun test tests/debug/settings/config-routes.test.ts`
- [x] 3.4 Close any route-level gap (expected near-zero: GET and PATCH already flow through `getConfigFieldsForContext` and `validateConfigField` against `field.options`). Verify: `bun test tests/debug/settings/config-routes.test.ts`
- [x] 3.5 TDD red: extend `tests/client/settings/sections/AiOutputSection.test.ts` — the new select renders with its hint line; a stored value no longer among the options displays "Provider default" while the stored string is untouched. Verify: `bun test tests/client/settings/sections/AiOutputSection.test.ts` (fails)
- [x] 3.6 Implement the hint line and the display fallback in `client/settings/sections/AiOutputSection.svelte` (extension of the `visible` derived). Verify: `bun test tests/client/settings/sections/AiOutputSection.test.ts`

## 4. Request wiring

- [x] 4.1 TDD red: extend `tests/llm-model-builder.test.ts` with request-body captures via `setMockFetch` — set + in-set → body carries `reasoning_effort`; unset → body byte-identical to today; catalogue `reasoning: false` + stored level → key absent; stored value outside catalogue levels → key absent; effort + maxOutputTokens coexist in one request. Verify: `bun test tests/llm-model-builder.test.ts` (fails)
- [x] 4.2 Implement the optional trailing effort param and the `providerOptions: { openaiCompatible: { reasoningEffort } }` middleware merge in `src/llm-model-builder.ts` (single wrap when a cap or an effort is present). Verify: `bun test tests/llm-model-builder.test.ts`
- [x] 4.3 TDD red: extend `tests/llm-orchestrator.test.ts` — the `buildModel` spy receives the effective effort for the context's stored setting; unset → not passed; the turn verifier inherits the same model instance. Verify: `bun test tests/llm-orchestrator.test.ts` (fails)
- [x] 4.4 Implement the optional effort argument through `LlmOrchestratorDeps.buildModel` (src/llm-orchestrator-types.ts) and the gate resolution in `callLlm` (src/llm-orchestrator.ts). Verify: `bun test tests/llm-orchestrator.test.ts`
- [x] 4.5 TDD red: extend `tests/deferred-prompts/proactive-llm.test.ts` — proactive/deferred `buildModel` receives the effective effort; unset → not passed; the proactive verification pass inherits it. Verify: `bun test tests/deferred-prompts/proactive-llm.test.ts` (fails)
- [x] 4.6 Implement the same pass-through in `src/deferred-prompts/proactive-llm.ts`. Verify: `bun test tests/deferred-prompts/proactive-llm.test.ts`

## 5. Full gates and docs

- [x] 5.1 Seam-shape and affected-loop checks: `bun test:stories:contracts` (the optional trailing param keeps `buildModel` seams assignable) and `bun run test:affected`
- [ ] 5.2 Update the affected doc page: one bullet in `docs/architecture/behaviors.md` (owner-set reasoning effort per config context, catalogue-derived options with union fallback, auxiliary LLM paths keep provider defaults). Verify: `bun run format:check`
- [ ] 5.3 Final gates over the whole tree: `bun run test`, `bun run typecheck`, `bun run lint` — all green (query a red run with `bun run test:failures` before re-running anything)

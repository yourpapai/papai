<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Pin the failing behaviour

- [x] 1.1 In `tests/opencode-agent/provider-proxy.test.ts`, inside the existing
      `contain (claude route)` block, extend the factory-options test to assert
      `options.pricing.provider === 'anthropic'` and
      `options.pricing.model === 'claude-sonnet-5'` — the block already loads
      `LLM_MODEL: 'anthropic/claude-sonnet-5'`, so this is red today
      (`openai` / `anthropic/claude-sonnet-5`). Verify:
      `bun test tests/opencode-agent/provider-proxy.test.ts` fails on exactly
      those two assertions.
- [x] 1.2 Add a case to the same block with `LLM_PROVIDER: 'zai-coding-plan'` in
      `CLAUDE_ENV`, asserting the pricing provider is still `anthropic` and that
      the gateway id appears nowhere in `options.pricing`. Verify: red on the
      provider assertion, `bun test tests/opencode-agent/provider-proxy.test.ts`.
- [x] 1.3 Add a case with an unprefixed `LLM_MODEL` (`claude-sonnet-5`),
      asserting the model id passes through unchanged — the strip must not
      mangle the ordinary spelling. Verify:
      `bun test tests/opencode-agent/provider-proxy.test.ts`.

## 2. Derive the claude route's pricing reference

- [x] 2.1 Export `modelIdForCli` from `opencode-agent/src/claude-argv.ts`
      (design D2), unchanged in behaviour, with a doc line saying it is now the
      shared definition of "the id the CLI was invoked with". Verify:
      `bun run typecheck`, and the argv suites
      (`bun test tests/opencode-agent/claude-contract.test.ts tests/opencode-agent/claude-doctrine.test.ts`)
      stay green.
- [x] 2.2 In `opencode-agent/src/claude-spend.ts`, add the exported derivation
      (a named constant for the `anthropic` catalogue id plus a function
      returning the settings spread with `provider` and `model` replaced), with
      the reason recorded in its doc comment: `LLM_PROVIDER` is the gateway
      route's catalogue key and the CLI reaches Anthropic. Verify:
      `bun run typecheck`.
- [x] 2.3 In `opencode-agent/src/contain.ts`, replace
      `pricing: contained.openai` with the derived settings and add the one
      import. Keep the edit to one expression plus one import — the file is at
      297 of 300 `max-lines`. Verify: tasks 1.1–1.3 go green
      (`bun test tests/opencode-agent/provider-proxy.test.ts`) and
      `bun run lint` reports no `max-lines` failure.

## 3. Pin the consuming side

- [ ] 3.1 In `tests/opencode-agent/run-spend.test.ts`, add the leg proving a
      reference whose model id still carries a provider prefix
      (`openai/anthropic/claude-sonnet-5`) resolves to no catalogue row and
      reports unpriced — the regression this change closes, pinned where it was
      observable. Verify: `bun test tests/opencode-agent/run-spend.test.ts`.
- [ ] 3.2 Confirm the opencode route is untouched: the existing
      `modelRef`/adapter assertions in
      `tests/opencode-agent/openai-config.test.ts` and
      `tests/opencode-agent/adapters.test.ts` pass unchanged. Verify:
      `bun test tests/opencode-agent/openai-config.test.ts tests/opencode-agent/adapters.test.ts`.

## 4. Correct the documentation the code contradicted

- [ ] 4.1 In `opencode-agent/README.md`, fix the backend-selection item that
      says `LLM_PROVIDER` is unused because "the claude route skips the
      models.dev catalogue read": the route skips the boot-time *model-facts*
      read and prices under `anthropic`. Verify: the claimed behaviour matches
      the spec delta, and `bun run format:check` passes.
- [ ] 4.2 In `opencode-agent/CLAUDE.md`, extend the "provider id is a catalogue
      key" note to say the key is route-scoped: `LLM_PROVIDER` on the opencode
      route, `anthropic` on the claude route. Verify: `bun run format:check`.

## 5. Verification

- [ ] 5.1 Run `bun run test`, `bun run typecheck`, `bun run lint` and
      `bun run test:mutate:changed` for the touched files; read failures from
      `reports/` rather than re-running. All green, mutation score at or above
      the per-file baseline.
- [ ] 5.2 Confirm no `docs/architecture/*.md` page describes the pricing
      reference (the accounting ladder is documented in this change's specs and
      in `opencode-agent/README.md`); update none if none applies, and say so.

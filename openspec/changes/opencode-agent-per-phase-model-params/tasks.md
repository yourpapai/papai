<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Per-phase model and inference parameters

Depends on `opencode-agent-model-catalogue-provider` and
`opencode-agent-model-metadata-fallback`: an effort variant exists only when
`capabilities.reasoning` is true, which those changes establish.

## 1. Config loading

- [x] 1.1 Failing test: `LLM_MODEL_LIGHT` unset falls back to `LLM_MODEL`; set,
      it is read and trimmed — `bun test tests/opencode-agent/config.test.ts`
- [x] 1.2 Failing test: `AGENT_EFFORT_PLAN` / `AGENT_EFFORT_BUILD` accept a
      short lowercase token, reject whitespace, uppercase, slashes and
      over-length values with a `ConfigError` naming the variable, and are
      absent when unset (D4) — `bun test tests/opencode-agent/config.test.ts`
- [x] 1.3 Widen `OpenAiSettings` / `PipelineConfig` and implement the three
      loaders; watch 1.1-1.2 pass —
      `bun test tests/opencode-agent/config.test.ts`
- [x] 1.4 `cd opencode-agent && bun run typecheck && bun run lint`

## 2. Emitted config

- [x] 2.1 Failing test: `agent.plan.model` is the light model ref and
      `small_model` is set to it, while `agent.propose` and `agent.build` carry
      no `model` override (D2) —
      `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.2 Failing test: `agent.plan.variant` / `agent.build.variant` are emitted
      only when their variable is set, and the three permission profiles are
      byte-identical to today either way —
      `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.3 Failing test: `provider.<id>.options.setCacheKey` is `true` and
      `options.{apiKey,baseURL}` are unchanged (D5) —
      `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.4 Failing test: with all three variables unset, the emitted config
      differs from the pre-change fixture only by `setCacheKey` (D3) —
      `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.5 Implement the agent entries, `small_model` and `setCacheKey` in
      `buildOpencodeConfig`; watch 2.1-2.4 pass —
      `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.6 Update the `provider-proxy` inlined-config fixture —
      `bun test tests/opencode-agent/provider-proxy.test.ts`

## 3. Manual verification against the installed CLI

The SDK's generated type and the server's config reader disagree about which
agent keys exist (design — Risks), so what the *server* honours is only
observable by running it. Verified by hand, against `opencode-ai@1.18.7`.

- [ ] 3.1 Confirm the installed server accepts the emitted config and reports
      the per-agent model and variant — `opencode agent list` with
      `OPENCODE_CONFIG_CONTENT` set to the generated config
- [ ] 3.2 Run a read-only phase (a `/ask` comment) and confirm from the run log
      that it used the light model —
      `cd opencode-agent && bun run start -- --event-path <fixture>`
- [ ] 3.3 Run an implement turn with `AGENT_EFFORT_BUILD` set and confirm the
      reasoning token count in the session usage is non-zero —
      `cd opencode-agent && bun run start -- --event-path <fixture>`
- [ ] 3.4 Confirm the review loop's `opencode run` subprocesses pick up
      `build`'s variant from the config (D1) — run `/review` on a test pull
      request and check the subprocess transcript
- [ ] 3.5 Record all four observations, including the effort tier chosen for
      this repository's model, in `opencode-agent/ROADMAP.md` — no command;
      review the diff

## 4. Docs and full gates

- [x] 4.1 Add the three variables to the `opencode-agent/README.md` env table
      and note the profile→model/effort mapping in `opencode-agent/CLAUDE.md` —
      no command; review the diff
- [x] 4.2 Full gates: `bun test`, `bun run typecheck`, `bun run lint`

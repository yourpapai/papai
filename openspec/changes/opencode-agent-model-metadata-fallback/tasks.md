<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Model metadata fallback for the agent pipeline

Depends on `opencode-agent-model-catalogue-provider` — D3's third precedence
tier is the catalogue merge that change makes reachable.

## 1. Widen the models.dev reader

- [x] 1.1 Failing test: `lookupModel("<provider>/<model>")` returns the parsed
      entry with `limit`, `reasoning`, `tool_call`, `temperature` and
      `attachment`, and `null` for a provider or model the database lacks —
      `bun test tests/sdd-runner/pricing.test.ts`
- [x] 1.2 Failing test: an entry missing any of those optional fields still
      parses, and one malformed entry does not reject the database (D2) —
      `bun test tests/sdd-runner/pricing.test.ts`
- [x] 1.3 Regression test: `resolveCost` behavior — primary, median fallback,
      and unknown — is unchanged when routed through `lookupModel` —
      `bun test tests/sdd-runner/pricing.test.ts`
- [x] 1.4 Widen `ModelEntrySchema` and add `lookupModel`; re-point
      `resolveCost` at it; watch 1.1-1.3 pass —
      `bun test tests/sdd-runner/pricing.test.ts`
- [x] 1.5 `bun run typecheck` and `bun run lint` clean —
      `bun run typecheck && bun run lint`

## 2. Overrides at load

- [x] 2.1 Failing test: `AGENT_MODEL_CONTEXT` / `AGENT_MODEL_OUTPUT` outside
      their range, and non-integer values, raise `ConfigError` naming the
      variable; unset leaves the field absent rather than zero (D3, D5) —
      `bun test tests/opencode-agent/config.test.ts`
- [x] 2.2 Failing test: `AGENT_MODEL_REASONING` parses as a boolean knob and is
      absent when unset — `bun test tests/opencode-agent/config.test.ts`
- [x] 2.3 Implement the three overrides in `config.ts` / `config-values.ts` and
      widen `OpenAiSettings`; watch 2.1-2.2 pass —
      `bun test tests/opencode-agent/config.test.ts`

## 3. Precedence and splice

The resolution and the splice turned out to be two units, not one: the lookup is
async and `buildOpencodeConfig` must stay synchronous, since it is the single
definition serving both the in-process session and the `OPENCODE_CONFIG_CONTENT`
the review loop reads. So the resolver is `model-metadata.ts` with its own suite,
and the splice stays a field on the settings the builder already takes.

- [x] 3.1 Test, tier by tier: an override wins over a models.dev hit; a hit wins
      over a miss; a miss emits **no** `limit`/`reasoning` keys at all so
      OpenCode's own merge stays free to fill them (D3) —
      `bun test tests/opencode-agent/model-metadata.test.ts`
- [x] 3.2 Test: a rejecting reader, a synchronous throw, and the empty database
      an unreachable host degrades to all fall to the next tier, warn once, and
      never throw (D4) — `bun test tests/opencode-agent/model-metadata.test.ts`
- [x] 3.3 Test: the boot debug line reports the model reference, the context
      window, `reasoning` and the tier that supplied them, and never the key or
      base URL — `bun test tests/opencode-agent/model-metadata.test.ts`
- [x] 3.4 Implement the resolver, the splice onto the model entry, and the
      `runCli` wiring, with exactly one function permitted to swallow (D4) —
      `bun test tests/opencode-agent/model-metadata.test.ts tests/opencode-agent/openai-config.test.ts`
- [x] 3.5 Confirm the emitted config is unchanged when every tier misses and no
      override is set, on both execution paths —
      `bun test tests/opencode-agent/openai-config.test.ts`

## 4. Security and manual verification

- [ ] 4.1 Semgrep clean over the new fetch surface — `bun security`
- [ ] 4.2 Manual: run the pipeline with a model id absent from models.dev and
      no overrides; confirm the log names the miss and the run still completes —
      `cd opencode-agent && bun run start -- --event-path <fixture>`
- [ ] 4.3 Manual: repeat with `AGENT_MODEL_CONTEXT` set; confirm the log reports
      the override tier and that a long turn compacts instead of overflowing —
      `cd opencode-agent && bun run start -- --event-path <fixture>`
- [ ] 4.4 Record both observations in `opencode-agent/ROADMAP.md`, per the
      workspace rule that behavior is recorded rather than assumed — no
      command; review the diff

## 5. Docs and full gates

- [ ] 5.1 Document the three overrides and the precedence in the
      `opencode-agent/README.md` env table; note the cross-workspace import in
      `opencode-agent/CLAUDE.md` and the widened reader in
      `docs/architecture/sdd-pipeline.md` — no command; review the diff
- [ ] 5.2 Full gates: `bun test`, `bun run typecheck`, `bun run lint`

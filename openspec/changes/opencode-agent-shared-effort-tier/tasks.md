## 1. Shared tier resolution at config load (design D1, D2)

- [x] 1.1 Red-first `tests/opencode-agent/config.test.ts`: `AGENT_EFFORT=high` alone resolves all three profile tiers to `high`; a per-profile variable (`AGENT_EFFORT_PLAN=low`) overrides it for that profile only; everything unset leaves `planEffort`/`proposeEffort`/`buildEffort` `null`; a malformed `AGENT_EFFORT` raises `ConfigError` naming the key — `bun test tests/opencode-agent/config.test.ts`
- [x] 1.2 Implement the resolution in `opencode-agent/src/config.ts:101-105` — read `AGENT_EFFORT` once through the existing `effortTier` (`config-model-values.ts`), fold it into the three profile fields as `AGENT_EFFORT_<PROFILE> ?? AGENT_EFFORT ?? null`; no new module, no tier enum — `bun test tests/opencode-agent/config.test.ts`

## 2. Emit the tier on the opencode route (design D3, D7)

- [x] 2.1 Red-first `tests/opencode-agent/openai-config.test.ts`: the `propose` profile carries `variant` when a tier resolves; the emitted config has no `variant` key anywhere when none does; the `reasoning: false` catalogue gate still empties the variants (pin the unchanged behaviour) — `bun test tests/opencode-agent/openai-config.test.ts`
- [ ] 2.2 Add `proposeEffort` to `ModelProfiles` (`opencode-agent/src/openai-config.ts:41-56`) and its `null` to `NO_MODEL_PROFILES`; emit `variant: profiles.proposeEffort` on the `propose` profile at `:250` — `bun test tests/opencode-agent/openai-config.test.ts`

## 3. Carry the tier on the claude route (design D3, D6, D7)

- [ ] 3.1 Red-first `tests/opencode-agent/claude-adapter.test.ts`: a `propose` turn emits `--effort <tier>` immediately after `--model` when a tier resolves and emits no `--effort` when it does not; `plan`/`build` unchanged — `bun test tests/opencode-agent/claude-adapter.test.ts`
- [ ] 3.2 Add `proposeEffort` to `ClaudeModelKnobs` and return it from `profileSelection`'s `propose` branch (`opencode-agent/src/claude-argv.ts:127`) instead of the hardcoded `null`; carry it through `opencode-agent/src/contain.ts:162-165`; update every `ClaudeModelKnobs` fixture, including `tests/opencode-agent/claude-doctrine.test.ts:62`'s and `tests/opencode-agent/provider-proxy.test.ts`'s — `bun test tests/opencode-agent/claude-adapter.test.ts tests/opencode-agent/provider-proxy.test.ts tests/opencode-agent/claude-doctrine.test.ts`

## 4. Gap 1 — effort on the review loop's claude subprocesses (design D4, D5, D6)

- [ ] 4.1 Red-first `tests/review-loop/agent-command.test.ts`: the claude branch emits `--effort <tier>` adjacent to `--model`, emits nothing when the field is absent, and the opencode branch's argv is byte-identical in both cases — `bun test tests/review-loop/agent-command.test.ts`
- [ ] 4.2 Red-first for the loop-side validation: a role config with a malformed `effort` is refused at config load with an error naming the field, and a well-shaped one parses — `bun test tests/review-loop/config.test.ts`
- [ ] 4.3 Add the optional `effort` string to `AgentConfigSchema` (`review-loop/src/config.ts:23-37`) as a Zod refinement duplicating the `effortTier` shape check across the documented workspace boundary — `bun test tests/review-loop/config.test.ts`
- [ ] 4.4 Add `effort?: string` to `AgentCommandOptions` and append `'--effort', effort` after `--model` in `claudeCommand` (`review-loop/src/agent-command.ts:207-226`); `opencodeCommand` ignores the field — `bun test tests/review-loop/agent-command.test.ts`
- [ ] 4.5 Thread `effort` through `RunAgentOptions` and `attemptRun` (`review-loop/src/agent-runner.ts:53,135`) and the role call sites that build it from their role config: `review-round.ts:104,145`, `issue-processor-attempts.ts:57`, `issue-processor-batch.ts:113`, `issue-matcher.ts`, `issue-inspector.ts` — `bun run review-loop:test`
- [ ] 4.6 Extend `tests/opencode-agent/claude-doctrine.test.ts`'s tail-equality case to a set tier on both sides, so a one-sided `--effort` change fails the pin — `bun test tests/opencode-agent/claude-doctrine.test.ts`

## 5. The pipeline writes the tier into the loop's role config (design D4)

- [ ] 5.1 Red-first `tests/opencode-agent/review-runner.test.ts`: the role `agent` object the pipeline writes carries `effort` from `buildEffort` on the claude backend, omits it when no tier resolves, and is unchanged on the opencode backend — `bun test tests/opencode-agent/review-runner.test.ts`
- [ ] 5.2 Set `effort: settings.openai.profiles?.buildEffort ?? null` on the claude branch of the role `agent` object (`opencode-agent/src/review-runner.ts:88-92`), leaving the opencode branch alone so the tier keeps riding `OPENCODE_CONFIG_CONTENT` — `bun test tests/opencode-agent/review-runner.test.ts`

## 6. Docs, workflow hand-off, full verification

- [ ] 6.1 Update `opencode-agent/README.md`: the env table (`:1655-1656`) gains `AGENT_EFFORT` and `AGENT_EFFORT_PROPOSE` with the per-profile-wins precedence rule and the `reasoning: false` catalogue caveat; the profile table (`:1837-1841`) gains the `propose` tier and drops the backend caveat implied at `:1841`; the claude-route note (`:2113-2115`) records that the loop's claude subprocesses now carry `--effort` — `bun run lint`
- [ ] 6.2 Add one line on the shared variable and its precedence to `opencode-agent/CLAUDE.md:664-668` — `bun run lint`
- [ ] 6.3 Record the workflow hand-off (it cannot be applied from this pipeline — `.github/workflows/` edits cannot be pushed by the agent's token): write the exact two `env:` forwarding lines for `AGENT_EFFORT` and `AGENT_EFFORT_PROPOSE`, sited beside the existing pair at `.github/workflows/agent-pipeline.yml:529-530`, into the PR body for a maintainer to apply by hand — verify by reading `.github/workflows/agent-pipeline.yml:520-540` and confirming the anchor lines and indentation quoted in the hand-off match the file
- [ ] 6.4 One full `bun run test`, `bun run typecheck`, `bun run lint` — all green; then review `docs/architecture/sdd-pipeline.md` and `docs/architecture/commands.md` and update them in the same commit if either documents the effort knobs

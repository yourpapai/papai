## 1. Probe (no code under test)

- [x] 1.1 Probe the installed `@fission-ai/openspec` CLI under `skip_specs: true`: scaffold a throwaway change, set the flag in its `.openspec.yaml`, and record what `openspec status --json`, `openspec instructions tasks --json` and `openspec validate --strict` report with zero spec deltas (does the artifact graph still gate tasks on specs? do instructions resolve?). Delete the probe; record outcomes in design.md under Decision 3. Verification: probe outcomes recorded, and `openspec validate <probe> --strict` output quoted in the record

## 2. skip_specs decision and metadata write

- [x] 2.1 Failing tests in `tests/opencode-agent/phases.test.ts`, then implement: triage's `capture` variant in `opencode-agent/src/phases/triage.ts` gains `skipSpecs: boolean`; the capture prompt in `opencode-agent/src/prompts.ts` carries the decision rule (spec-level change = a downstream observer of the contract sees an added/changed/removed requirement), the bias-to-true for fix-class issues, and the mandatory "None — skip_specs proposed because ⟨reason⟩" Capabilities-section rationale. Verification: `bun test tests/opencode-agent/phases.test.ts`
- [x] 2.2 Failing tests in `tests/opencode-agent/openspec-driver.test.ts`, then implement: when triage returned `skipSpecs: true`, the scaffold path writes `skip_specs: true` into the change's `.openspec.yaml` immediately after `newChange` — a deterministic TS patch fed by the validated output, with the model's diff-guard scope unchanged (it never writes metadata). Verification: `bun test tests/opencode-agent/openspec-driver.test.ts`

## 3. Planning honors the flag

- [x] 3.1 Failing tests then implement: `opencode-agent/src/phases/plan-draft.ts` reads the scaffolded change's skip_specs metadata and composes design-or-recorded-skip plus tasks without requesting spec deltas; the validate-retry loop is preserved for genuine failures. Shape per probe 1.1's recorded behavior. Verification: `bun test tests/opencode-agent/phases.test.ts`

## 4. Capability-granularity guidance

- [x] 4.1 Extend the capture and planning prompts (`opencode-agent/src/prompts.ts`): capabilities are named at feature-domain granularity, never issue-sized; new-capabilities-only while `openspec/specs/` holds no archived corpus. Prompt-content assertions in the mapped suite first. Verification: `bun test tests/opencode-agent/phases.test.ts`

## 5. Docs and final gate

- [x] 5.1 Update `opencode-agent/CLAUDE.md`: the skip_specs posture (rule, bias, park-level correction), and a pointer to the depth doctrine in this change's design.md. Verification: `bun run format:check`
- [x] 5.2 Full verification; confirm no `docs/architecture/*.md` page is affected (the agent is documented in its own workspace). Verification: `bun test`, `bun run typecheck`, `bun run lint` all green

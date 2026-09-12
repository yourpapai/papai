<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: MCP servers knob for the agent pipeline

Test-first throughout (design — Hooks/TDD): each section writes the failing test,
watches it fail, implements, watches it pass. Spec reference:
`specs/opencode-agent-mcp-servers-knob/spec.md`.

## 1. Parse and refuse — `mcp-servers.ts`

- [x] 1.1 Write the failing parse tests in
      `tests/opencode-agent/mcp-servers.test.ts`: unset/blank → no servers; valid
      `local` (`command`, optional `environment`) and `remote` (`url`, optional
      `headers`) entries accepted; invalid JSON → `ConfigError` naming
      `AGENT_MCP_SERVERS`; an `oauth` object → refusal naming the unattended
      constraint; a server name outside `[A-Za-z0-9_-]+` → refusal naming the
      tool-prefix rule; unknown fields → refusal (minimal schema, design Non-goals).
      Verify: `bun test tests/opencode-agent/mcp-servers.test.ts` (fails: module
      absent)
- [x] 1.2 Implement `opencode-agent/src/mcp-servers.ts`: the Zod schema, two-stage
      refusal (syntax vs shape, the `check-spec.ts` pattern), name validation, and
      `parseMcpServers(raw)` re-exported through `config-values.ts` beside
      `parseChecks`.
      Verify: `bun test tests/opencode-agent/mcp-servers.test.ts`

## 2. Emission and grants — the single builder

- [x] 2.1 Write the failing emission tests (in
      `tests/opencode-agent/openai-config.test.ts`): with servers set, the emitted
      config carries the `mcp` block, remotes with `oauth: false` forced; `plan` and
      `build` maps each gain `"<name>_*": "allow"` after their existing allows;
      `propose` gains no MCP key; the global default carries the key; with no
      servers, the emitted config is byte-identical to the pre-change output.
      Verify: `bun test tests/opencode-agent/openai-config.test.ts` (fails)
- [x] 2.2 Implement: `mcpServers?: McpServers` on `OpenAiSettings` (the `profiles`
      precedent), emit the block and the generated grant keys inside
      `buildOpencodeConfig`/`grant()` composition (order: allows after `"*": "deny"`).
      Verify: `bun test tests/opencode-agent/openai-config.test.ts`
- [x] 2.3 Wire the knob into configuration loading (`config.ts` reads
      `AGENT_MCP_SERVERS` into `openai.mcpServers`) with a failing test first in
      `tests/opencode-agent/config.test.ts`: set knob → rides the settings; unset →
      absent field.
      Verify: `bun test tests/opencode-agent/config.test.ts`

## 3. Credential scrubbing — `pipelineSecrets`

- [x] 3.1 Write the failing test: `pipelineSecrets` includes every `headers` and
      `environment` value from the configured servers (value ≥ the existing
      minimum-length rule), so `scrubSecrets` removes them and `redactSecrets`
      replaces them; unset knob changes the list not at all.
      Verify: `bun test tests/opencode-agent/config.test.ts` (fails) — or the suite
      section covering `secrets.ts`, wherever `pipelineSecrets` is currently asserted
- [x] 3.2 Extend `pipelineSecrets` in `opencode-agent/src/secrets.ts` to collect
      from `config.openai.mcpServers`.
      Verify: `bun test tests/opencode-agent/config.test.ts`

## 4. Workflow and documentation

- [x] 4.1 Add the `env:` forwarding line to `.github/workflows/agent-pipeline.yml`:
      `AGENT_MCP_SERVERS: ${{ secrets.AGENT_MCP_SERVERS || vars.AGENT_MCP_SERVERS }}`
      beside the other `AGENT_*` knobs; run `bun run workflows:lint` (the pinned
      actionlint gate) and the workflow test suite.
      Verify: `bun run workflows:lint && bun test tests/opencode-agent/workflow.test.ts`
- [x] 4.2 Document the knob in `opencode-agent/README.md`'s knob table: the JSON
      shape with a pinned-`bunx` local example and a static-header remote example,
      the OAuth prohibition, the model-readability warning (one `echo` away, S3-9)
      with the unauthenticated-local / afford-to-expose guidance, and the
      review-loop fan-out note beside `AGENT_REVIEW_POOL_SIZE`.
      Verify: `bun run format:check`

## 5. Final verification

- [x] 5.1 Full suite and checks over the whole diff; update the workspace
      `CLAUDE.md`'s "One model endpoint" section if the MCP seam needs a sentence
      (the knob rides `OpenAiSettings`; containment unchanged), and confirm no papai
      `docs/architecture/*.md` page is affected (none are — the workspace is
      standalone). Check off this file as tasks complete per the apply guidance.
      Verify: `bun run test && bun run typecheck && bun run lint && bun run format:check && bun security`

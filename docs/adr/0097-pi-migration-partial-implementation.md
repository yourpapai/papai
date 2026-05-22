<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0097: Pi Migration — Partial Implementation with Intentional Divergences

## Status

Accepted

## Date

2026-05-17

## Context

On 2026-04-27 the project authored `docs/superpowers/plans/2026-04-27-pi-migration.md` with the goal of replacing papai's OpenCode-specific agent setup with a Pi-based equivalent. The plan envisioned:

1. Porting three OpenCode plugins to Pi extensions:
   - TDD enforcement (`enforce-tdd.mjs`, `enforce-write-policy.mjs`, git safety gates)
   - Codeindex reindex (debounced auto-reindex after qualifying `src/` / `client/` edits)
   - TPS meter (live tokens-per-second UI during assistant streaming)
2. Adding `.pi/settings.json` and `.mcp.json` for shared project configuration.
3. Migrating user-scope providers and credentials (drowbridge, macbook, openrouter, deepseek).
4. Strengthening `CLAUDE.md` for the Pi-native workflow.
5. Creating an operator guide (`docs/guides/pi-agent.md`).

Between the plan's creation and implementation evaluation (today), the project made several decisions that changed the assumptions of the migration plan:

- **ADR-0096** (2026-04-29) removed the OpenCode TPS meter plugin with the rationale that it was "no longer providing value in the papai workspace."
- **ADR-0094** (2026-05-12) deprecated the single-proxy tool (`papai_tool`) architecture, confirming the project had completed its departure from OpenCode-specific design patterns.
- The provider landscape shifted: `synthetic` became the default provider (`"defaultProvider": "synthetic"`), replacing the previously dominant `drowbridge` endpoint.
- The existing `~/.pi/agent/extensions/custom-providers/index.ts` extension superseded the static `models.json` approach, offering dynamic model list refresh against provider `/models` endpoints.

## Decision Drivers

1. **OpenCode is fully deprecated**: No OpenCode configuration or plugins remain in the workspace. The migration is now a belt-tightening exercise rather than a dual-harness transition.
2. **TPS meter intentionally removed**: ADR-0096 explicitly killed this component as unused eye candy. Rebuilding it in Pi contradicts that decision.
3. **Dynamic provider extension is superior**: The global TypeScript `custom-providers` extension handles model registration, refresh, and API key resolution holistically. A static `models.json` would be a regression.
4. **User auth hygiene**: API keys for `context7` and `synthetic` belong in user-scope `~/.pi/agent/mcp.json`, not in repository `.mcp.json`, which would risk accidental commit.
5. **What already works, works**: The superpowers skill workflow is functional today via `~/.pi/agent/settings.json` and `~/.pi/agent/AGENTS.md`. No superseding needed.

## Considered Options

### Option 1: Implement the plan exactly (rejected)

- **Pros**: Satisfies the document as written.
- **Cons**: Wastes effort porting a TPS meter the project already decided to delete (ADR-0096). Creates `models.json` when a dynamic TS extension already exists. Commits API keys or forces templating into repository `.mcp.json`. No functional improvement for the user.
- **Verdict**: Rejected.

### Option 2: Accept partial implementation, document divergences (accepted)

- **Pros**: Respects later decisions (ADR-0096, ADR-0094). Keeps the workspace clean. Does not regress dynamic provider architecture. Documents where the plan is stale for future reference.
- **Cons**: Plan remains partially unexecuted; requires an ADR to explain why.
- **Verdict**: Accepted.

### Option 3: Delete the migration plan and extensions, start fresh (rejected)

- **Pros**: Clean slate — no confusion about stale plans.
- **Cons**: The TDD enforcement and codeindex-reindex extensions are useful, working code. The operator guide (`docs/guides/pi-agent.md`) already helps the team. Throwing them away wastes proven value.
- **Verdict**: Rejected.

## Decision

Accept the partial and divergent outcome of the Pi migration plan. Archival and active-state mapping:

| Plan Artifact                                                | Disposition                        | Rationale                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.pi/settings.json`                                          | **Create** with extension wiring   | Two Pi extensions exist in `.pi/extensions/` but Pi may not auto-discover them without a local settings file.     |
| TPS meter extension (`tracker.ts`, `token-counter.ts`, etc.) | **Do not create**                  | ADR-0096 removed the feature; no replacement needed.                                                              |
| `models.json`                                                | **Do not create**                  | Superseded by global `custom-providers` TS extension.                                                             |
| `drowbridge` provider directory                              | **Do not create**                  | Project default is `synthetic`; drowbridge is no longer the primary endpoint.                                     |
| `context7` + `synthetic` in repo `.mcp.json`                 | **Keep in `~/.pi/agent/mcp.json`** | API key secrets must stay out of the repository.                                                                  |
| TDD enforcement + codeindex reindex extensions               | **Keep**                           | Already implemented and correct.                                                                                  |
| `docs/guides/pi-agent.md`                                    | **Keep**                           | Active operator reference.                                                                                        |
| `CLAUDE.md` Pi workflow section                              | **Keep**                           | Already covers instruction loading and search protocol natively. No additional Copilot instruction loader needed. |

## Rationale

- The migration plan was written against an OpenCode world that no longer exists. Several of its tasks assumed OpenCode was still running.
- The two Pi extensions that _were_ ported (TDD enforcement, codeindex reindex) reuse the robust `.hooks/` logic and deserve to stay active.
- The operator guide already converts OpenCode habits to Pi commands. No additional session-workflow documentation is needed.
- The TPS meter, `models.json`, and `drowbridge` provider are cases where the project evolved past the plan rather than falling behind it.

## Consequences

### Positive

- No wasted work rebuilding a TPS meter the project deliberately removed.
- No regression from a dynamic provider extension back to a static JSON file.
- No API key leakage risk in committed `.mcp.json`.
- Repository stays focused: only project-global `codeindex` MCP server configuration is in `.mcp.json`.

### Negative

- `.pi/settings.json` does not yet exist, so Pi may not load the two project-local extensions. A one-time creation task remains.

### Risks

- If `.pi/settings.json` is never created, the TDD and reindex extensions become dead code. They will not block unsafe edits or auto-reindex the codebase.
  - **Mitigation**: Create `.pi/settings.json` with the two extension paths listed.

## Implementation Notes

### Files that exist and are correct

- `.pi/extensions/tdd-enforcement/index.ts` — Pi `tool_call` / `tool_execution_end` / `agent_end` hooks wrapping `.hooks/` logic.
- `.pi/extensions/codeindex-reindex/index.ts` — Debounced reindex via `bun run scripts/codeindex-cli.ts reindex`.
- `docs/guides/pi-agent.md` — Operator guide mapping sessions, MCP, superpowers, subagents.
- `~/.pi/agent/settings.json` — Global Pi settings with `pi-mcp-adapter`, `pi-subagents`, `~/.agents/skills`.
- `~/.pi/agent/AGENTS.md` — Forces `using-superpowers` at session start.
- `~/.pi/agent/auth.json` — API keys for openrouter, opencode, synthetic, zai, etc., plus OAuth for github-copilot and openai-codex.
- `~/.pi/agent/mcp.json` — User-scope MCP servers (`context7`, `synthetic`).
- `~/.pi/agent/extensions/custom-providers/index.ts` — Dynamic provider registration (`localhost`, `synthetic`, `zai`, `ollama-cloud`, `xiaomi`).

### Files deliberately not created

- `.pi/extensions/tps-meter/*` — Removed per ADR-0096.
- `~/.pi/agent/models.json` — Superseded by `custom-providers` extension.
- `~/.pi/agent/extensions/drowbridge/` — Default provider changed to `synthetic`.
- Explicit `Path-Scoped Instruction Loading` section in `CLAUDE.md` — Superseded by existing "Pi Workflow" and "Codebase Search Protocol" sections.

### Files to create

- `.pi/settings.json` — Register local extensions:
  ```json
  {
    "extensions": [".pi/extensions/tdd-enforcement", ".pi/extensions/codeindex-reindex"]
  }
  ```

## Related Decisions

- **ADR-0096** — TPS meter intentionally removed; this explains why Task 5 of the plan was skipped.
- **ADR-0094** — OpenCode proxy architecture deprecated; confirms the project completed its exit from OpenCode-specific patterns.

## References

- Migration plan (to be archived): `docs/superpowers/plans/2026-04-27-pi-migration.md`
- Divergence notes: `docs/superpowers/notes/0097-pi-migration-divergences.md`
- Global Pi settings: `~/.pi/agent/settings.json`

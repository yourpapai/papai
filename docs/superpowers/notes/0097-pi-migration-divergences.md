<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0097: Pi Migration — Divergence Notes

> Companion document to ADR-0097. Captures each deviation between the 2026-04-27 Pi migration plan, the current project state, and the accepted delivery state.

---

## Deviation 1: TPS meter extension not ported (intentional)

| Field         | Value                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task** | Task 5 — entire TPS meter extension suite (`index.ts`, `tracker.ts`, `token-counter.ts`, `config.ts`, `types.ts`, `.pi/tps-meter.json`)                                                                                                             |
| **Expected**  | Pi-native footer/status TPS display using `message_update` → `ctx.ui.setStatus`                                                                                                                                                                     |
| **Actual**    | Nothing created. No `tps-meter/` directory exists in `.pi/extensions/`.                                                                                                                                                                             |
| **Why**       | ADR-0096 (2026-04-29) removed the OpenCode TPS meter plugin with the rationale it was "no longer providing value." Porting the same feature to Pi would directly contradict that accepted decision. The feature was eye candy, not safety-critical. |
| **Impact**    | No TPS display during assistant streaming. The team has operated without it since ADR-0096 with no reported friction.                                                                                                                               |
| **Correct?**  | Yes — intentional skip.                                                                                                                                                                                                                             |

---

## Deviation 2: Drowbridge provider extension not created (superseded)

| Field         | Value                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task** | Task 3 Step 3 — `~/.pi/agent/extensions/drowbridge/index.ts` using `DROWBRIDGE_API_KEY` from env                                                                                                               |
| **Expected**  | A dedicated drowbridge provider extension registering models dynamically.                                                                                                                                      |
| **Actual**    | `~/.pi/agent/extensions/drowbridge/` does not exist. Default provider is `synthetic` (`hf:moonshotai/Kimi-K2.6`).                                                                                              |
| **Why**       | The `drowbridge` self-hosted endpoint was the dominant provider at plan-write time. Since then, `synthetic` (with hosted model access) became the default. The team no longer needs drowbridge for daily work. |
| **Impact**    | None for current workflow. If drowbridge is needed again, the extension pattern is well-understood from `custom-providers/index.ts`.                                                                           |
| **Correct?**  | Yes — provider defaults changed.                                                                                                                                                                               |

---

## Deviation 3: `models.json` not created (superseded)

| Field         | Value                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task** | Task 3 Step 4 — `~/.pi/agent/models.json` with a `macbook` provider entry for local model parity.                                                                                                                                             |
| **Expected**  | Static JSON file listing `macbook` provider (`http://127.0.0.1:8000/v1`) and its models (`Gemma-4-26B-A4B`, `Qwen3.6-35B-A3B`).                                                                                                               |
| **Actual**    | `~/.pi/agent/models.json` does not exist. The `localhost` provider is registered dynamically by `~/.pi/agent/extensions/custom-providers/index.ts` with model refresh on `session_start`.                                                     |
| **Why**       | The `custom-providers` TypeScript extension is strictly superior: it fetches live `/models` on session start, avoids stale model lists, and handles API key resolution through `ctx.modelRegistry.getApiKeyForProvider()` plus env fallbacks. |
| **Impact**    | Positive — local models are always up-to-date with the endpoint rather than pinned in a JSON file.                                                                                                                                            |
| **Correct?**  | Yes — dynamic extension supersedes static config.                                                                                                                                                                                             |

---

## Deviation 4: `context7` and `synthetic` absent from repo `.mcp.json` (intentional)

| Field         | Value                                                                                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task** | Task 2 Step 1 — `.mcp.json` at repo root containing `context7`, `synthetic`, and `codeindex` entries.                                                                                                                                                                              |
| **Expected**  | Shared project MCP config with all three servers, using `${CONTEXT7_API_KEY}` / `${SYNTHETIC_API_KEY}` env var templating.                                                                                                                                                         |
| **Actual**    | Repo `.mcp.json` contains only `codeindex`. `context7` and `synthetic` live in `~/.pi/agent/mcp.json` with actual API key values.                                                                                                                                                  |
| **Why**       | API keys for third-party services must not be committed to the repository. Env var templating (`${VAR}`) is not universally supported by all MCP consumers and creates a "it works on my machine" surface. Keeping user-scoped servers in user files is a clean security boundary. |
| **Impact**    | Each user clones the repo but must bring their own `context7`/`synthetic` config. This is correct — the project can't share paid API keys.                                                                                                                                         |
| **Correct?**  | Yes — security boundary is worth the deviation from the plan.                                                                                                                                                                                                                      |

---

## Deviation 5: `.pi/settings.json` missing (needs fix)

| Field         | Value                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task** | Task 1 Step 1 — `.pi/settings.json` with `packages`, `skills`, `enableSkillCommands`.                                                                                              |
| **Expected**  | A committed project-local Pi settings file.                                                                                                                                        |
| **Actual**    | File does not exist. Global `~/.pi/agent/settings.json` has the packages and skills.                                                                                               |
| **Why**       | Possibly oversight — the packages were installed globally rather than locally during the migration, and the extensions were created but never registered in a local settings file. |
| **Impact**    | **High risk**. The two project-local extensions (TDD enforcement, codeindex reindex) are not referenced from any settings file Pi reads. They may be sitting inert.                |
| **Correct?**  | **No** — `.pi/settings.json` should be created with the two extension paths. See ADR-0097 "Implementation Notes" for the exact JSON.                                               |

---

## Deviation 6: No explicit "Path-Scoped Instruction Loading" section in `CLAUDE.md` (acceptable)

| Field         | Value                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task** | Task 6 Step 1 — Add `## Path-Scoped Instruction Loading` telling Pi to read `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md`.                                                                                                                                                                                                                                   |
| **Expected**  | A new section in `CLAUDE.md` mapping scope to instruction files.                                                                                                                                                                                                                                                                                                                              |
| **Actual**    | `CLAUDE.md` has `## Pi Workflow` and `## Codebase Search Protocol` instead. It already tells Pi how to search and what conventions to follow. No mention of loading GitHub Copilot instruction files.                                                                                                                                                                                         |
| **Why**       | Pi natively loads `CLAUDE.md` (and `AGENTS.md`). GitHub Copilot instruction files (`.github/copilot-instructions.md`) are a Copilot-specific mechanism that Pi does not natively support. Rather than build a loader extension, the team strengthened `CLAUDE.md` directly with the instructions Pi needs. This is simpler and avoids a custom extension that might break across Pi versions. |
| **Impact**    | None — the instruction content is present in the file Pi actually reads.                                                                                                                                                                                                                                                                                                                      |
| **Correct?**  | Yes — native instruction file > custom loader.                                                                                                                                                                                                                                                                                                                                                |

---

## Deviation 7: Post-hook split into preflight + tracking (acceptable evolution)

| Field         | Value                                                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task** | Task 4 Steps 1–2 — Two separate extension files (one for preflight + one for post-edit tracking)                                                                                                                                       |
| **Expected**  | `.pi/extensions/tdd-enforcement/index.ts` (preflight) and `.pi/extensions/tdd-enforcement/post-edit.ts` (tracking + full check) as separate modules.                                                                                   |
| **Actual**    | All TDD logic is in a single `index.ts` (9.7K). It handles `tool_call`, `tool_execution_end`, and `agent_end`.                                                                                                                         |
| **Why**       | A single extension is simpler. Pi event handlers are stateless functions; splitting them into two files with no shared runtime boundary adds indirection without benefit. The single-file approach is easier to test and reason about. |
| **Impact**    | Positive — less cognitive overhead.                                                                                                                                                                                                    |
| **Correct?**  | Yes — architectural refinement.                                                                                                                                                                                                        |

---

## Deviation 8: Reindex command path changed (`scripts/codeindex-cli.ts`)

| Field         | Value                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task** | Task 4 Step 3 — `bun run codeindex/src/cli.ts reindex`                                                                                                                                                                                                      |
| **Expected**  | CLI entry point at `codeindex/src/cli.ts`                                                                                                                                                                                                                   |
| **Actual**    | `.pi/extensions/codeindex-reindex/index.ts` spawns `bun run scripts/codeindex-cli.ts reindex`                                                                                                                                                               |
| **Why**       | The `codeindex` directory was extracted into a standalone project (see `ef8b3587 refactor: extract codeindex workspace into standalone project`). The CLI wrapper in the main repo moved to `scripts/codeindex-cli.ts`. The extension was updated to match. |
| **Impact**    | None — correct path per current repo layout.                                                                                                                                                                                                                |
| **Correct?**  | Yes — extension tracks repo evolution.                                                                                                                                                                                                                      |

---

## Remediation Checklist

- [ ] **Create `.pi/settings.json`** with extension wiring:
  ```json
  {
    "extensions": [".pi/extensions/tdd-enforcement", ".pi/extensions/codeindex-reindex"]
  }
  ```
- [ ] **Verify Pi loads the extensions** in a fresh session (`pi` in repo root; try `git stash` → should be blocked).
- [ ] **(Optional)** If Pi does not resolve relative extension paths in `.pi/settings.json`, switch to a symlink under `~/.pi/agent/extensions/` or convert each extension to a local Pi package with `package.json`.

## Related

- ADR-0097 (parent)
- ADR-0096 (TPS meter removal)
- ADR-0094 (OpenCode proxy deprecation)
- `docs/superpowers/plans/2026-04-27-pi-migration.md` (to be archived)

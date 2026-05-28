<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Command Retirement & Migration Spec

**Date:** 2026-05-28
**Status:** Draft spec
**Parent:** [`2026-05-28-settings-web-ui-overview-design.md`](./2026-05-28-settings-web-ui-overview-design.md)

## Scope

The decided end state is **web UI only, hard removal** (overview D2): once
the UI reaches parity, the interactive chat-configuration flows are
deleted, not kept as a fallback. This spec defines what becomes a thin
launcher, what is removed outright, the parity gate that authorizes
removal, and the safe sequencing so the bot is never left without a
configuration path.

## End state

| Command | Fate |
| --- | --- |
| `/config` | **Launcher.** Issues a one-time code and replies with the settings URL (sub-spec 2). Sole entry point to the UI. |
| `/setup` | **Removed.** Onboarding folds into the UI (config + identity + provider + Kaneo provision). `/config`'s link is the entry. Optionally `/start` mentions the link for first-run. |
| `/config` interactive editor | **Removed** (`src/config-editor/`). |
| Setup wizard | **Removed** (`src/wizard/`). |
| Group settings selector | **Removed** (`src/group-settings/selector.ts`); the *access* helpers (`access.ts`, `target-validation.ts`) are **kept** — sub-spec 3 reuses them. |
| Tool toggle UI | **Removed** (`src/chat/tool-toggle-interaction-handler.ts`, `src/commands/tool-config-view.ts`). |
| Plugin toggle UI | **Removed** (`src/chat/plugin-interaction-handler.ts`). |
| AI-output config UI | **Removed** (`src/ai-output-config-ui.ts`, `ai-output-config-interaction.ts`). |
| `/plugin` | **Removed** (admin plugin mgmt moves to the UI admin area). Consider keeping a launcher only if admins need a non-UI path. |
| `/group` / `/groups` | **Removed**; membership + group authorization move to UI. |
| `/user` / `/users` | **Removed**; authorized-user mgmt moves to UI. |
| `/announce` | **Removed** as a command; broadcast logic extracted to a reusable function called by the UI admin area. |
| `/help`, `/start`, `/context`, `/clear` | **Kept** (not configuration flows). `/help` text updated to point at `/config`. |

The interaction router (`src/chat/interaction-router.ts`) loses the
`gsel:`, `cfg:`, `cfg:ai:`, `wizard_`, `tgl:`, `plg:` branches. The
message-interception path in `bot.ts`/`bot-settings.ts` that captures
wizard/config/selector text input is removed; incoming non-command text
goes straight to the orchestrator.

## What must NOT be removed

These are pure logic/stores the web layer depends on — keep them:

- `src/config.ts`, `src/config-keys.ts`, `src/config-editor/validation.ts`
  (validation reused server-side).
- `src/tools/tool-preferences.ts`, `tool-metadata.ts`.
- `src/mcp/user-endpoints.ts`, `src/mcp/types.ts`.
- `src/plugins/store.ts`, `registry.ts`, and the plugin runtime.
- `src/group-settings/access.ts`, `target-validation.ts`.
- All authorization + instance + identity + system-config stores.
- The `/announce` broadcast mechanics (extracted, not deleted).

The removal targets are the **presentation/state-machine** layers, not
the data layer.

## Parity gate (OQ4)

Hard removal is authorized only when the UI demonstrably covers every
capability the removed flow offered. Proposed checklist, verified before
each removal PR:

1. Every config field from `getConfigFieldsForContext` editable in the
   UI for personal and group contexts.
2. Tool toggles: domain + per-tool parity with the chat drill-down.
3. MCP add/edit/remove/enable + tool filters.
4. Plugin per-context enable/disable + config entry; admin
   approve/reject.
5. Group member add/remove; group authorization; authorized users;
   admin roster; system LLM config; instances CRUD; announce.
6. Identity link/clear.
7. Kaneo group auto-provision path.
8. Authorization parity: the same principals can/can't do the same
   things as in chat (sub-spec 3 matrix), verified by tests.

## Sequencing

Removal trails delivery so there is never a gap with no config path:

1. **Land the UI** (auth → API → SPA, sub-specs 2/4/5) behind the
   existing build, with `/config` *additionally* able to emit a link
   while the old editor still works.
2. **Verify parity** against the gate checklist (tests + manual).
3. **Flip `/config`** to launcher-only; delete the config-editor, wizard,
   selector-UI, tool/plugin/ai-output interaction handlers, and the
   router branches + interception path.
4. **Remove management commands** (`/setup`, `/plugin`, `/group`,
   `/user`, `/announce`), extracting `/announce`'s broadcast first.
5. **Cleanup:** delete now-dead callback-data/state modules, prune
   command registrations in `src/bot.ts` and menu registration in
   `src/chat/startup.ts`, update `/help`.

Each step is its own PR; step 3+ only after the parity gate passes.

## Docs & operational impact

- Update `CLAUDE.md` (command surface, `/config` behavior, removed
  commands) and `src/commands/CLAUDE.md`, `src/chat/CLAUDE.md`.
- Update `README`/user docs and `docs/ROADMAP.md`.
- The bot must surface the settings URL prominently in `/start` and when
  it replies "not configured", so users always have a path in.
- Knip (`bun knip`) will flag the removed modules' now-unused exports —
  use it to confirm the deletion is complete and nothing dangling
  remains.

## Risks

- **Accessibility regression for chat-only users:** some users may be on
  networks where the web UI is hard to reach. Mitigation is the exposure
  work in sub-spec 2; flag if a chat fallback for a minimal subset (e.g.
  identity linking) is ever required — but per D2 the decision is hard
  removal.
- **Removing too early:** the parity gate + per-step PRs guard against
  this; do not delete a flow before its UI equivalent ships and passes
  tests.
- **Hidden coupling:** the message-interception path is entangled with
  the queue in `bot.ts`; removal needs care to not change normal-message
  handling. Cover with tests before deleting.

## Open questions

- OQ-R1 — Keep a `/plugin` admin launcher for environments without the
  web UI, or remove fully (this spec assumes full removal)?
- OQ-R2 — Should `/setup` remain as an alias that emits the same link as
  `/config`, for discoverability, rather than being removed outright?

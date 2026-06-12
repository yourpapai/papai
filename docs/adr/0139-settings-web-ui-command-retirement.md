<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0139: Settings Web UI — Command Retirement & Migration

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

papai had two configuration surfaces: an in-chat interactive editor (button-driven
callbacks routed through `interaction-router.ts` with prefixes `cfg:`, `gsel:`,
`wizard_`, `plg:`, `tgl:`) and a growing set of management commands (`/setup`,
`/plugin`, `/group`/`/groups`, `/user`/`/users`, `/announce`). The chat surface was
fragile — deeply nested callback state machines, platform-specific button limitations,
no CSRF protection, and a message-interception path in `bot.ts`/`bot-settings.ts`
that gated the orchestrator queue. Adding new config fields required changes in both
the callback state machine and the editor presentation, duplicating validation logic.

The settings web UI (`src/settings/`, `client/settings/`) reached parity with every
chat-configuration capability: config fields, tool toggles, MCP endpoints, plugin
admin, group membership, authorized users, identity, instances, system LLM, and
announcements. The web UI uses HTTP sessions with synchronizer-token CSRF, scoped
authorization, and a single-use link issued via `/config` — a strictly better
security and UX model.

With parity achieved, the chat config surface was pure duplication and maintenance
burden. The interception path in `bot.ts` was a particularly risky coupling: when
`maybeInterceptWizard` returned `true`, the incoming message never reached the
orchestrator, silently swallowing user input.

## Decision Drivers

- **Single source of truth**: Configuration should have one interaction model, not
  two that must be kept in sync.
- **Security**: Chat callback flows have no CSRF protection; the web UI has
  synchronizer-token CSRF and session-scoped authorization.
- **Queue integrity**: The message-interception path (`maybeInterceptWizard`) must
  not silently suppress messages destined for the orchestrator.
- **Parity gate**: No capability may be removed before its web-UI equivalent ships
  and passes automated tests.
- **No regression in normal-message handling**: Non-command text must reach the
  orchestrator queue unchanged after the interception path is deleted.
- **Data layer preservation**: The underlying stores, validators, and access helpers
  that the web layer depends on must not be weakened or removed.

## Considered Options

### Option A: Keep both surfaces (chat + web) indefinitely

Maintain the interactive editor and management commands alongside the web UI.

- **Pros**: Chat-only users retain a config path; no migration risk.
- **Cons**: Permanent duplication of every config capability across two interaction
  models; callback state machines are fragile and platform-limited; interception
  path remains a queue-safety risk; every new config field requires two
  implementations.

### Option B: Hard removal — web UI only (chosen)

Delete all chat-configuration flows and management commands. `/config` becomes a
launcher that issues a single-use settings link. The interaction router becomes a
near-empty safe sink. The interception path is removed.

- **Pros**: Eliminates duplication; removes the message-interception queue risk;
  CSRF-protected config surface; simpler mental model for users.
- **Cons**: Users on networks where the web UI is unreachable lose the in-chat
  config path; `SETTINGS_PUBLIC_BASE_URL` becomes effectively required.

### Option C: Soft removal — keep `/config` legacy fallback

Remove all commands and interaction flows except the in-chat config editor, which
remains as a fallback when `SETTINGS_PUBLIC_BASE_URL` is unset.

- **Pros**: Deployment flexibility for environments without a public URL.
- **Cons**: Retains the most complex callback state machine (the config editor) and
  its interception coupling; defeats the simplification goal.

### Option D: Keep `/setup` and `/plugin` as launchers

Remove the interactive editors but preserve `/setup` and `/plugin` as thin launchers
that emit the same link as `/config`.

- **Pros**: Discoverability for users who expect these command names.
- **Cons**: Three commands that do the same thing; `/config` already covers this;
  adds maintenance for no functional gain.

## Decision

**Option B** — hard removal, web UI only. Subsidiary decisions:

| Topic                                                                                                      | Decision                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/config`                                                                                                  | Launcher-only. Issues a single-use settings link. Replies with a "set SETTINGS_PUBLIC_BASE_URL" message when unconfigured.                                       |
| `/setup`                                                                                                   | Removed outright. No alias. `/start` points users at `/config`.                                                                                                  |
| `/plugin`                                                                                                  | Removed fully. No admin launcher. Plugin approve/reject + per-context enable/disable live only in the settings UI admin area.                                    |
| `/group`, `/groups`                                                                                        | Removed. Membership and group authorization move to the UI.                                                                                                      |
| `/user`, `/users`                                                                                          | Removed. Authorized-user management moves to the UI.                                                                                                             |
| `/announce`                                                                                                | Removed as a command. Broadcast logic (`broadcastMessage`) extracted and kept; the settings admin route calls it directly.                                       |
| Interaction router                                                                                         | All config-flow callback prefixes (`gsel:`, `cfg:`, `wizard_`, `plg:`, `tgl:`) removed. Router authorizes the actor and matches nothing — a safe sink.           |
| Message interception                                                                                       | `maybeInterceptWizard` path in `bot.ts`/`bot-settings.ts` deleted. Non-command text goes straight to the orchestrator queue.                                     |
| Preserved data layer                                                                                       | `config-keys.ts`, `config-editor/validation.ts`, `tool-preferences.ts`, `mcp/user-endpoints.ts`, plugin store/registry/runtime, `group-settings/access.ts`,      |
| `target-validation.ts`, all authorization/instance/identity/system-config stores, `announce-broadcast.ts`. |
| `SETTINGS_PUBLIC_BASE_URL`                                                                                 | Effectively required. After legacy fallback deletion, `/config` replies with a clear "ask the administrator to set SETTINGS_PUBLIC_BASE_URL" message when unset. |
| Parity gate                                                                                                | Hard removal authorized only after automated tests prove the web UI covers every removed capability (8-item checklist).                                          |

## Consequences

### Positive

- Single configuration interaction model eliminates dual-maintenance burden.
- Message-interception path removed: non-command text always reaches the
  orchestrator, fixing a latent queue-integrity risk.
- All configuration now protected by session-scoped CSRF and proper authorization
  (the chat callback flow had neither).
- `/help`, `/start`, and the "not fully configured" reply all point at `/config`,
  giving users a single clear path.
- Interaction router reduced to a safe sink — adapters that still emit interaction
  events have a stable entry point that cannot route to deleted handlers.
- Knip confirms no dangling exports remain after deletion.

### Negative

- Chat-only users on networks where the web UI is unreachable lose the in-chat
  config path. Per the design decision (D2), this is accepted.
- `SETTINGS_PUBLIC_BASE_URL` is effectively required; deployments without it have
  no configuration path at all.
- Users accustomed to `/setup`, `/plugin`, `/group`, `/announce` must learn the
  web-UI flow.

### Risks

- Removing the interception path incorrectly could change normal-message handling.
  Mitigation: characterization tests written before deletion, verified unchanged
  after.
- Removing a capability before its web-UI equivalent ships leaves a gap.
  Mitigation: parity-gate checklist with automated tests; each removal is its own
  PR gated on the checklist.
- `group-settings/access.ts` or `target-validation.ts` may become fully unused if
  the settings layer does not actually import them. Mitigation: knip flags this;
  surface as a finding rather than auto-deleting.

## Implementation Notes

Four phases, each a separate PR:

1. **Parity gate** — automated tests proving web UI covers every removed capability.
2. **Characterize interception** — pin normal-message orchestrator path with tests
   before deletion.
3. **Flip `/config` + remove interaction/interception layers** — launcher-only
   `/config`, empty interaction router, delete config-editor/wizard/selector-UI
   handlers, remove `maybeInterceptWizard` from `bot.ts`.
4. **Remove management commands + cleanup** — delete `/setup`, `/plugin`,
   `/group`/`/groups`, `/user`/`/users`, `/announce`; prune command catalog;
   update `/help`, `/start`, "not configured" reply; run knip; update docs.

Key deleted modules: `src/config-editor/{callback-data,handlers,index,state,types}.ts`,
`src/wizard/` (entire directory), `src/bot-settings.ts`, `src/bot-auto-setup.ts`,
`src/chat/{config-editor-integration,interaction-router-config,tool-toggle-interaction-handler,
plugin-interaction-handler,ai-output-config-interaction}.ts`,
`src/ai-output-config-ui.ts`, `src/group-settings/selector.ts`,
`src/commands/{setup,plugin,group,admin}.ts`.

Key rewritten modules: `src/commands/config.ts` (launcher-only),
`src/chat/interaction-router.ts` (safe sink), `src/bot.ts` (no interception),
`src/commands/catalog.ts`, `src/commands/help.ts`, `src/commands/start.ts`,
`src/llm-orchestrator.ts` (not-configured reply).

Design spec: `docs/archive/2026-05-28-settings-web-ui-command-retirement-design.md`.
Implementation plan: `docs/archive/2026-05-30-settings-web-ui-command-retirement.md`.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin admin moves from `/plugin` command
  to the settings UI admin area; plugin runtime and store are preserved.
- ADR-0138: Settings Web UI Access Model — the session/CSRF/authorization model
  that replaces the chat callback flows.
- ADR-0014: Multi-Chat Provider Abstraction — adapters still emit interaction
  events; the router safe sink absorbs them.

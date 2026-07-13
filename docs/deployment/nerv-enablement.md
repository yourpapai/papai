<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Enabling the nerv coding-supervisor plugin

The `nerv` plugin (`plugins/nerv/`) drives long-running, supervised GitLab-MR coding tasks through
the external **nerv** service. It ships `defaultEnabled: false` and is fully inert until an admin
configures it. This runbook covers the token matrix, enabling the plugin, and a smoke-test checklist
before turning it on for real users.

## 1. Token matrix

nerv sits between papai and magi. Three tokens must line up across the three deployments:

| papai config                                   | nerv env var         | magi env var                        |
| ---------------------------------------------- | -------------------- | ----------------------------------- |
| `nerv_token` (plugin admin config, per-plugin) | `NERV_AUTH_TOKEN`    | —                                   |
| `NOTIFY_TOKEN` (papai env)                     | `PAPAI_NOTIFY_TOKEN` | —                                   |
| —                                              | —                    | `MAGI_NOTIFY_URL` → nerv, not papai |

- `nerv_token` must equal nerv's `NERV_AUTH_TOKEN` — this is the bearer papai sends on every
  `POST /tasks`, `GET /tasks/:id`, `POST /tasks/:id/events` call.
- papai's `NOTIFY_TOKEN` must equal nerv's `PAPAI_NOTIFY_TOKEN` — nerv relays task milestones back
  through papai's existing `POST /api/notify` (see `docs/architecture/environment.md`), the same
  proactive-notify path already used by other coding-session integrations.
- magi's `MAGI_NOTIFY_URL` must point at **nerv**, not papai directly — magi only ever talks to
  nerv; nerv is the one that talks to papai. Getting this backwards silently breaks status updates
  without any error surfaced to the operator.

## 2. Required papai configuration

In the settings UI, admin section, plugin config for `nerv`:

- `nerv_base_url` — nerv's reachable base URL (e.g. `https://nerv.internal.example.com`).
- `nerv_token` — the bearer token, must equal nerv's `NERV_AUTH_TOKEN` (see above).

Per group/context (optional, settings UI, plugin config for `nerv`, context scope):

- `output_language` — e.g. `English`, `Russian`. Governs the language nerv writes its task output
  and follow-up responses in. Unset defaults to English on the nerv side.

## 3. Enabling the plugin

1. Set `nerv_base_url` / `nerv_token` as above.
2. In the settings UI admin Plugins section, enable `nerv` for the target platform instance (it
   ships `defaultEnabled: false`).
3. Verify connectivity: **Admin · Coding sessions** in the settings UI shows a "nerv coding
   tasks:" status line — it must read **Connected**. **Not configured** means
   `nerv_base_url`/`nerv_token` are missing; **Unreachable** means nerv is unreachable or
   erroring — check the token matrix above and nerv's own logs before proceeding.

## 4. Smoke-test checklist (manual, staging)

Run through this full loop in a staging platform instance before enabling nerv for real users:

- [ ] **Create** — ask the bot to supervise an MR on a configured repo (`create_coding_task`);
      confirm a task record appears and nerv opens/updates a merge request.
- [ ] **PR** — confirm the MR link surfaces via `coding_task_status`/`list_coding_tasks`.
- [ ] **Review-comment fix** — leave a review comment on the MR; confirm the task iterates on it.
- [ ] **CI fix** — break CI on the MR; confirm the task pushes a fix and CI goes green.
- [ ] **Cancel-and-reap** — cancel the task mid-flight (`cancel_coding_task`); confirm the task
      closes and the underlying magi session(s) are torn down (not left running).
- [ ] **Language toggle** — set `output_language` to a non-English value for a test group, create
      a task, and confirm the task's primary output (not just a hardcoded string) is in that
      language; confirm an unset `output_language` still defaults to English.
- [ ] **Follow-up** — while a task is running, send a follow-up instruction
      (`followup_coding_task`); confirm it is honestly acknowledged only when actually applied
      (not a blanket "done").

Only flip `nerv` to enabled for production groups once every item above is checked.

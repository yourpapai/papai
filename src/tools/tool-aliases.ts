// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Old tool name a renamed tool should inherit tool_prefs overrides from. */
export const RENAMED_TOOL_ALIASES: Readonly<Record<string, string>> = {
  create_reminder: 'create_deferred_prompt',
  create_alert: 'create_deferred_prompt',
  list_reminders: 'list_deferred_prompts',
  get_reminder: 'get_deferred_prompt',
  update_reminder: 'update_deferred_prompt',
  cancel_reminder: 'cancel_deferred_prompt',
}

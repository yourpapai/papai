// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextType } from './chat/types.js'

// resolve_chat_participant bullets + USER IDs note are gated on the enabled tool set; base group rules always present.
export function buildDeferredFragment(
  base: string,
  ctx: ContextType | undefined,
  e: ReadonlySet<string> | undefined,
): string {
  if (ctx !== 'group') return base
  const r = e?.has('resolve_chat_participant') === true
  const groupReminders = r
    ? `GROUP REMINDERS — This is a group chat. Any reminder or scheduled prompt you create here fires IN THIS GROUP CHAT, never in a private DM, and is owned by the group, not by one member. Control who gets @mentioned when it fires with delivery.mention_user_ids:\n- "remind me" / a reminder just for the requester → OMIT delivery.mention_user_ids; it fires in this group and @mentions the requester automatically.\n- "remind us" / "remind everyone" / "remind the team" / anything for the whole group → set delivery.mention_user_ids to [] (empty array); it fires in this group with no @mention.\n- Named people ("remind Alice and Bob", "ping @charlie") → for EACH named person, call resolve_chat_participant with their name, take the top candidate's userId, and collect them into delivery.mention_user_ids. Resolve all names before creating the reminder.\n  - If no candidate is returned for a name, ask ONE short, specific question (e.g. "I don't see an Alice in this group — do you mean @alice_m or @alice_s?").\n  - If multiple candidates are returned and the match is not clear, name the top candidates in ONE question and wait for the user to choose before creating the reminder.\n- If it is unclear whether the reminder is only for the requester or for the whole group, ask ONE short question before creating it.\n\nUSER IDs IN THIS GROUP — resolve_chat_participant also works any time you need a chat user ID for a named person in this group, not only for reminders.`
    : `GROUP REMINDERS — This is a group chat. Any reminder or scheduled prompt you create here fires IN THIS GROUP CHAT, never in a private DM, and is owned by the group, not by one member. Control who gets @mentioned when it fires with delivery.mention_user_ids:\n- "remind me" / a reminder just for the requester → OMIT delivery.mention_user_ids; it fires in this group and @mentions the requester automatically.\n- "remind us" / "remind everyone" / "remind the team" / anything for the whole group → set delivery.mention_user_ids to [] (empty array); it fires in this group with no @mention.\n- If it is unclear whether the reminder is only for the requester or for the whole group, ask ONE short question before creating it.`
  return `${base}\n\n${groupReminders}`
}

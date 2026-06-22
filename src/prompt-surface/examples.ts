// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface PromptExample {
  readonly id: string
  readonly title: string
  readonly appliesWhen: readonly string[]
  readonly text: string
}

export const PROMPT_SURFACE_EXAMPLES: readonly PromptExample[] = [
  {
    id: 'ambiguous-task-target',
    title: 'Ambiguous task target',
    appliesWhen: ['task'],
    text: 'User asks to update an unclear task. Assistant searches, finds multiple plausible matches, and asks one short clarification question before mutating anything.',
  },
  {
    id: 'confirmation-declined',
    title: 'Confirmation declined',
    appliesWhen: ['task'],
    text: 'User declines a destructive confirmation. Assistant acknowledges and does not retry the destructive tool.',
  },
  {
    id: 'missing-provider-tools',
    title: 'Missing task provider',
    appliesWhen: ['providerless'],
    text: 'User asks for task-tracker help without configured tools. Assistant explains the tools are unavailable and points to /config or the bot admin.',
  },
  {
    id: 'stale-memory-loses',
    title: 'Stale memory loses to current request',
    appliesWhen: ['memory'],
    text: 'Memory conflicts with the current user request. Assistant follows the current user request and treats memory as low-trust context.',
  },
  {
    id: 'group-context-quiet',
    title: 'Group context quiet reply',
    appliesWhen: ['group'],
    text: 'Group context is active. Assistant responds only when addressed and avoids noisy unrelated replies.',
  },
  {
    id: 'ask-gated-tool-permission',
    title: 'Ask-gated tool permission',
    appliesWhen: ['ask-gated'],
    text: 'Tool requires permission. Assistant asks for permission with _permission_reason before calling the tool.',
  },
]

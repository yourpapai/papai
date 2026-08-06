<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import TimelineEvent from './TimelineEvent.svelte'

  const { Story } = defineMeta({ title: 'transcript/TimelineEvent', component: TimelineEvent })
</script>

<Story
  name="Message"
  args={{
    event: {
      seq: 1,
      ts: 't',
      type: 'update',
      payload: { sessionUpdate: 'agent_message_chunk', content: 'Reading the file…' },
    },
  }}
/>

<Story
  name="Tool call"
  args={{
    event: {
      seq: 2,
      ts: 't',
      type: 'update',
      payload: { sessionUpdate: 'tool_call', title: 'edit history.ts', status: 'completed' },
    },
  }}
/>

<Story
  name="Permission (read-only)"
  args={{ event: { seq: 3, ts: 't', type: 'permission_request', payload: {} } }}
/>

<Story
  name="Result"
  args={{ event: { seq: 4, ts: 't', type: 'result', payload: { stopReason: 'end_turn' } } }}
/>

<!-- Review-only states: branches of TimelineEvent no existing story rendered. -->

<Story
  name="Thought"
  args={{
    event: {
      seq: 5,
      ts: 't',
      type: 'update',
      payload: {
        sessionUpdate: 'agent_thought_chunk',
        content: 'The failing assertion is in the merge path, so the seq comparison is the place to look first.',
      },
    },
  }}
/>

<Story
  name="Plan"
  args={{
    event: {
      seq: 6,
      ts: 't',
      type: 'update',
      payload: {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Reproduce the failure', status: 'completed' },
          { content: 'Fix the seq comparison', status: 'in_progress' },
          { content: 'Add a regression test', status: 'pending' },
        ],
      },
    },
  }}
/>

<Story
  name="Permission decided"
  args={{ event: { seq: 7, ts: 't', type: 'permission_decision', payload: {} } }}
/>

<Story
  name="Unknown shape (raw fallback)"
  args={{
    event: {
      seq: 8,
      ts: 't',
      type: 'update',
      payload: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact' }] },
    },
  }}
/>

<Story
  name="Long message (overflow)"
  args={{
    event: {
      seq: 9,
      ts: 't',
      type: 'update',
      payload: {
        sessionUpdate: 'agent_message_chunk',
        content:
          'Reading src/analytics/aggregation/rollup-window-boundaries.ts to check whether the retention cohort boundary is inclusive, because the D7 figure disagrees with the D1 figure by exactly one bucket and that smells like an off-by-one at the window edge rather than a data problem.',
      },
    },
  }}
/>

<Story
  name="Tool call failed"
  args={{
    event: {
      seq: 10,
      ts: 't',
      type: 'update',
      payload: { sessionUpdate: 'tool_call', title: 'run tests', status: 'failed' },
    },
  }}
/>

<Story
  name="Prompt"
  args={{
    event: {
      seq: 11,
      ts: 't',
      type: 'prompt',
      payload: { prompt: 'The D7 retention figure looks off by one bucket — can you check the window boundary?' },
    },
  }}
/>

<Story
  name="Tool call pending"
  args={{
    event: {
      seq: 12,
      ts: 't',
      type: 'update',
      payload: { sessionUpdate: 'tool_call', title: 'read rollup-window-boundaries.ts', status: 'in_progress' },
    },
  }}
/>

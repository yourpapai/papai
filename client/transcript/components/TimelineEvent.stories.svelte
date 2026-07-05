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

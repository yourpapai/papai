<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import TranscriptView from './TranscriptView.svelte'
  import type { TranscriptEvent } from './fetcher-schemas.js'

  const { Story } = defineMeta({ title: 'transcript/TranscriptView', component: TranscriptView })

  const SESSION: TranscriptEvent[] = [
    {
      seq: 1,
      ts: '2026-08-06T14:23:05.000Z',
      type: 'prompt',
      payload: { prompt: 'The D7 retention figure looks off by one bucket — can you check the window boundary?' },
    },
    {
      seq: 2,
      ts: '2026-08-06T14:23:11.000Z',
      type: 'update',
      payload: {
        sessionUpdate: 'agent_thought_chunk',
        content: 'The D1 and D7 figures disagree by exactly one bucket, which smells like an inclusive window edge.',
      },
    },
    {
      seq: 3,
      ts: '2026-08-06T14:23:18.000Z',
      type: 'update',
      payload: {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Reproduce the off-by-one', status: 'completed' },
          { content: 'Fix the window boundary', status: 'in_progress' },
          { content: 'Add a regression test', status: 'pending' },
        ],
      },
    },
    {
      seq: 4,
      ts: '2026-08-06T14:23:24.000Z',
      type: 'update',
      payload: { sessionUpdate: 'tool_call', title: 'read rollup-window-boundaries.ts', status: 'completed' },
    },
    {
      seq: 5,
      ts: '2026-08-06T14:23:31.000Z',
      type: 'update',
      payload: { sessionUpdate: 'tool_call', title: 'run analytics tests', status: 'failed' },
    },
    {
      seq: 6,
      ts: '2026-08-06T14:23:37.000Z',
      type: 'update',
      payload: { sessionUpdate: 'agent_message_chunk', content: 'The boundary was inclusive on both ends. Fixed.' },
    },
    { seq: 7, ts: '2026-08-06T14:23:44.000Z', type: 'result', payload: { stopReason: 'end_turn' } },
  ]
</script>

<Story name="Populated" args={{ events: SESSION, status: 'finished' }} />

<Story name="Empty connecting" args={{ events: [], status: 'connecting' }} />

<Story name="Empty live" args={{ events: [], status: 'live' }} />

<Story name="Empty finished" args={{ events: [], status: 'finished' }} />

<Story name="Empty invalid token" args={{ events: [], status: 'invalid-token' }} />

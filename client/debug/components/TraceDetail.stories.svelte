<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeLlmTrace } from '../../stories/fixtures/debug.js'
  import TraceDetail from './TraceDetail.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/TraceDetail',
    component: TraceDetail,
  })
</script>

<Story name="Default" args={{ trace: makeLlmTrace() }} />

<Story
  name="With tool calls"
  args={{
    trace: makeLlmTrace({
      steps: 3,
      toolCalls: [
        { toolName: 'create_task', durationMs: 120, success: true, toolCallId: 'tc-1' },
        { toolName: 'search_tasks', durationMs: 80, success: false, error: 'timeout' },
      ],
    }),
  }} />

<Story name="Errored" args={{ trace: makeLlmTrace({ error: 'context length exceeded' }) }} />

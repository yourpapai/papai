<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeTurn } from '../../stories/fixtures/debug.js'
  import TurnDetail from './TurnDetail.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/TurnDetail',
    component: TurnDetail,
  })
</script>

<Story name="Completed" args={{ turn: makeTurn() }} />

<Story
  name="Errored"
  args={{
    turn: makeTurn({
      turnId: 't-err',
      status: 'error',
      error: 'tool execution failed',
      reply: undefined,
      toolCalls: [{ name: 'create_task', durationMs: 90, ok: false, failureReason: 'project not found' }],
    }),
  }} />

<Story name="Running" args={{ turn: makeTurn({ status: 'running', endedAt: undefined, reply: undefined }) }} />

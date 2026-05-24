<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeDashboardState, makeTurn } from '../stories/fixtures/debug.js'
  import DebugApp from './DebugApp.svelte'

  const { Story } = defineMeta({
    title: 'debug/DebugApp',
    component: DebugApp,
  })
</script>

<Story name="Populated" args={{ dashboard: makeDashboardState() }} />

<Story
  name="Detail selected"
  args={{ dashboard: makeDashboardState({ selectedDetail: { kind: 'turn', payload: makeTurn() } }) }} />

<Story
  name="Disconnected empty"
  args={{
    dashboard: makeDashboardState({
      connected: false,
      sessions: new Map(),
      wizards: new Map(),
      llmTraces: [],
      logs: [],
      logScopes: new Set(),
      turns: [],
      notifications: [],
      toolFailures: [],
    }),
  }} />

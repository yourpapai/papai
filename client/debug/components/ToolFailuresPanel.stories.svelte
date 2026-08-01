<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeDashboardState, makeToolFailure, SELECTED_FAILURE, SELECTED_FAILURE_LIST } from '../../stories/fixtures/debug.js'
  import ToolFailuresPanel from './ToolFailuresPanel.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/ToolFailuresPanel',
    component: ToolFailuresPanel,
  })

  const noop = () => undefined

  const failures = [
    makeToolFailure(),
    makeToolFailure({ data: { toolName: 'update_task', error: 'permission denied', errorType: 'auth' } }),
  ]
</script>

<Story name="Populated" args={{ dashboard: makeDashboardState({ toolFailures: failures }), onShowFailure: noop }} />

<Story name="Empty" args={{ dashboard: makeDashboardState({ toolFailures: [] }), onShowFailure: noop }} />

<Story
  name="Selected"
  args={{
    dashboard: makeDashboardState({
      toolFailures: SELECTED_FAILURE_LIST,
      selectedDetail: SELECTED_FAILURE,
    }),
    onShowFailure: noop,
  }} />

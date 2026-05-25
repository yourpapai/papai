<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeDashboardState, makeLlmTrace } from '../../stories/fixtures/debug.js'
  import TraceList from './TraceList.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/TraceList',
    component: TraceList,
  })

  const noop = () => undefined

  const traces = [makeLlmTrace(), makeLlmTrace({ steps: 4, error: 'rate limited' })]
</script>

<Story name="Populated" args={{ dashboard: makeDashboardState({ llmTraces: traces }), onSelect: noop }} />

<Story name="Empty" args={{ dashboard: makeDashboardState({ llmTraces: [] }), onSelect: noop }} />

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeDashboardState } from '../../stories/fixtures/debug.js'
  import DebugTopBar from './DebugTopBar.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/DebugTopBar',
    component: DebugTopBar,
  })
</script>

<Story name="Connected" args={{ dashboard: makeDashboardState() }} />

<Story name="Disconnected" args={{ dashboard: makeDashboardState({ connected: false }) }} />

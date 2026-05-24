<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeDashboardState } from '../../stories/fixtures/debug.js'
  import LiveContextCard from './LiveContextCard.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/LiveContextCard',
    component: LiveContextCard,
  })
</script>

<Story name="Default" args={{ dashboard: makeDashboardState() }} />

<Story name="Idle" args={{ dashboard: makeDashboardState({ connected: false, scheduler: {}, pollers: {} }) }} />

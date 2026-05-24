<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeGlobalStats } from '../../stories/fixtures/index.js'
  import StatsPanel from './StatsPanel.svelte'

  const { Story } = defineMeta({
    title: 'admin/components/StatsPanel',
    component: StatsPanel,
  })
</script>

<Story
  name="Populated"
  args={{ dashboard: { statsWindow: '30d', globalStats: makeGlobalStats() } }}
  parameters={{ fixtures: 'stats-populated' }} />

<Story
  name="Empty"
  args={{ dashboard: { statsWindow: '30d', globalStats: null } }}
  parameters={{ fixtures: 'stats-empty' }} />

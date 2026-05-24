<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import StatsSection from './StatsSection.svelte'

  const { Story } = defineMeta({
    title: 'admin/sections/StatsSection',
    component: StatsSection,
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'stats-populated' }} />

<Story name="Error" parameters={{ fixtures: 'stats-error' }} />

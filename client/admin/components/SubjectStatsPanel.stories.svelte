<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import SubjectStatsPanel from './SubjectStatsPanel.svelte'

  const { Story } = defineMeta({
    title: 'admin/components/SubjectStatsPanel',
    component: SubjectStatsPanel,
  })
</script>

<Story name="Populated" args={{ storageContextId: 'tg:1001' }} parameters={{ fixtures: 'stats-populated' }} />

<Story name="Error" args={{ storageContextId: 'tg:1001' }} parameters={{ fixtures: 'stats-error' }} />

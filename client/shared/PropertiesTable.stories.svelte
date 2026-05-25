<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import PropertiesTable from './PropertiesTable.svelte'

  const { Story } = defineMeta({
    title: 'shared/PropertiesTable',
    component: PropertiesTable,
  })
</script>

<Story
  name="Default"
  args={{
    obj: {
      id: 'tg:1001',
      contextType: 'dm',
      active: true,
      tags: ['urgent', 'billing'],
      meta: { retries: 2, lastError: null },
    },
  }} />

<Story name="Empty edge" args={{ obj: {} }} />

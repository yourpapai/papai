<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import SummaryList from './SummaryList.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/SummaryList',
    component: SummaryList,
  })
</script>

<Story
  name="System summary"
  args={{
    cols: 2,
    items: [
      { k: 'chat provider', v: 'telegram' },
      { k: 'task provider', v: 'unknown', pill: true },
      { k: 'debug server', v: 'enabled', pill: true },
      { k: 'admin user', v: 'configured', pill: true },
    ],
  }}
/>

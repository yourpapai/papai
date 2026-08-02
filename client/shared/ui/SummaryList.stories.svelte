<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import SummaryList from './SummaryList.svelte'
  import NarrowRail from '../../stories/decorators/NarrowRail.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/SummaryList',
    component: SummaryList,
    parameters: { layout: 'padded' },
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

<Story
  name="Long unbroken values"
  decorators={[() => ({ Component: NarrowRail })]}
  args={{
    items: [
      { k: 'User ID', v: 'tg:1001234567890' },
      { k: 'Response ID', v: 'resp_0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d' },
      { k: 'Model', v: 'gpt-4o-mini' },
    ],
  }}
/>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Bars from './Bars.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Bars',
    component: Bars,
  })
</script>

<Story name="Default" args={{ data: [3, 7, 2, 9, 5, 8, 4, 6, 5, 7] }} />

<Story name="Flat" args={{ data: [4, 4, 4, 4, 4, 4] }} />

<Story name="Single bar" args={{ data: [9] }} />

<Story name="Empty edge" args={{ data: [] }} />

<Story name="empty-edge">
  <div style="padding: 20px; background: var(--bg);">
    <Bars data={[]} width={200} height={40} />
  </div>
</Story>

<Story name="single-bar">
  <div style="padding: 20px; background: var(--bg);">
    <Bars data={[5]} width={200} height={40} />
  </div>
</Story>

<Story name="flat">
  <div style="padding: 20px; background: var(--bg);">
    <Bars data={[0, 0, 0, 0]} width={200} height={40} />
  </div>
</Story>

<Story name="fluid">
  <div style="padding: 20px; background: var(--bg); width: 600px;">
    <Bars data={[3, 7, 2, 9, 5, 11, 6, 4]} height={56} />
  </div>
</Story>

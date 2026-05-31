<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import MetricCard from './MetricCard.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/MetricCard',
    component: MetricCard,
  })
</script>

<Story name="default">
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 20px; background: var(--bg);">
    <MetricCard label="subjects" value={36} sub="32 dm · 4 group" />
    <MetricCard label="llm calls" value="1,089" sub="892 main · 197 small" accent="var(--accent)" />
    <MetricCard label="tools" value="4,390" sub="4,184 ok · 206 fail" />
    <MetricCard label="tokens" value="2.41M" sub="1.92M in · 487K out" />
  </div>
</Story>

<Story name="single">
  <div style="padding: 20px; max-width: 240px; background: var(--bg);">
    <MetricCard label="active 30d" value={7} sub="of 36" />
  </div>
</Story>

<Story name="no-sub">
  <div style="padding: 20px; max-width: 240px; background: var(--bg);">
    <MetricCard label="storage" value="184 MB" />
  </div>
</Story>

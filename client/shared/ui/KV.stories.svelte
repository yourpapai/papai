<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import KV from './KV.svelte'
  import Pill from './Pill.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/KV',
    component: KV,
  })
</script>

<Story name="Default" args={{ k: 'Messages', v: 42 }} />

<Story name="With sub" args={{ k: 'Latency', v: '120ms', sub: 'p95' }} />

<Story name="Colored value" args={{ k: 'Status', v: 'error', vColor: 'var(--danger)' }} />

<Story name="Dim" args={{ k: 'Idle since', v: '3h', dim: true }} />

<Story name="With Pill value" asChild>
  <KV k="status">
    {#snippet v()}
      <Pill tone="accent" dot>active</Pill>
    {/snippet}
  </KV>
</Story>

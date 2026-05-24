<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Panel from './Panel.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Panel',
    component: Panel,
  })
</script>

<Story name="Default" asChild>
  <Panel title="Sessions" count={12}>
    {#snippet body()}
      <p>panel body content</p>
    {/snippet}
  </Panel>
</Story>

<Story name="With action" asChild>
  <Panel title="Logs" count="1.2k">
    {#snippet action()}
      <button type="button">clear</button>
    {/snippet}
    {#snippet body()}
      <p>rows…</p>
    {/snippet}
  </Panel>
</Story>

<Story name="Dense flat edge" asChild>
  <Panel dense flat>
    {#snippet body()}
      <p>untitled dense flat panel</p>
    {/snippet}
  </Panel>
</Story>

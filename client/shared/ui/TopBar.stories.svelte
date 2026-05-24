<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import TopBar from './TopBar.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/TopBar',
    component: TopBar,
  })
</script>

<Story name="Default" asChild>
  <TopBar page="debug">
    {#snippet statusRow()}
      <span>connected · 3 sessions · 42 messages</span>
    {/snippet}
  </TopBar>
</Story>

<Story name="With secondary row" asChild>
  <TopBar page="admin">
    {#snippet statusRow()}
      <span>kaneo · telegram</span>
    {/snippet}
    {#snippet secondaryRow()}
      <span>window: 30d</span>
    {/snippet}
  </TopBar>
</Story>

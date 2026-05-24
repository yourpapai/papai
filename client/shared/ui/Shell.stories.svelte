<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Shell from './Shell.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Shell',
    component: Shell,
  })
</script>

<Story name="Default" asChild>
  <Shell>
    {#snippet topBar()}
      <div style="padding: 8px 12px;">top bar region</div>
    {/snippet}
    {#snippet children()}
      <div style="padding: 12px;">main content region</div>
    {/snippet}
  </Shell>
</Story>

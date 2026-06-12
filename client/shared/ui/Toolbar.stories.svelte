<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Toolbar from './Toolbar.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Toolbar',
    component: Toolbar,
  })
</script>

<Story name="Action cluster">
  {#snippet children()}<input placeholder="user id" /><button>load</button>{/snippet}
</Story>

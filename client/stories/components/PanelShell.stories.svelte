<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import PanelShell from './PanelShell.svelte'

  const { Story } = defineMeta({
    title: 'shared/PanelShell',
    component: PanelShell,
  })

  const longTitle = 'A very long panel title repeated to exercise header overflow — '.repeat(2)
</script>

<Story name="Default" args={{ title: 'Sessions' }}>panel body</Story>

<Story name="Empty" args={{ title: 'Sessions', count: 0 }}>(no sessions)</Story>

<Story name="Populated" args={{ title: 'Sessions', count: 42 }}>
  <ul>
    <li>session a1b2</li>
    <li>session c3d4</li>
    <li>session e5f6</li>
  </ul>
</Story>

<Story name="Long title edge" args={{ title: longTitle, count: 9999 }}>body</Story>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Seg from './Seg.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Seg',
    component: Seg,
  })
</script>

<Story name="Default" args={{ options: ['all', 'dm', 'group'], value: 'all' }} />

<Story name="Middle selected" args={{ options: ['1d', '7d', '30d', 'all'], value: '7d' }} />

<Story name="Two options" args={{ options: ['on', 'off'], value: 'off' }} />

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

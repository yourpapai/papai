<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Spark from './Spark.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Spark',
    component: Spark,
  })
</script>

<Story name="Default" args={{ data: [2, 4, 3, 6, 5, 8, 7, 9, 6, 7] }} />

<Story name="Line only" args={{ data: [2, 4, 3, 6, 5, 8, 7, 9], fill: false }} />

<Story name="Empty edge" args={{ data: [] }} />

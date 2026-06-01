<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Stat from './Stat.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Stat',
    component: Stat,
  })
</script>

<Story name="Within total" args={{ label: '7d', value: 9, of: 36 }} />
<Story name="Exceeds total" args={{ label: '30d', value: 13, of: 4 }} />

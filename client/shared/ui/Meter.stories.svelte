<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Meter from './Meter.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Meter',
    component: Meter,
  })
</script>

<Story name="Half" args={{ label: 'recurring', value: 2, total: 4 }} />
<Story name="Full" args={{ label: 'memos', value: 4, total: 4 }} />
<Story name="Over capacity" args={{ label: 'deferred', value: 6, total: 4 }} />

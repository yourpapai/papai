<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import MemosSection from './MemosSection.svelte'

  const { Story } = defineMeta({
    title: 'admin/sections/MemosSection',
    component: MemosSection,
  })
</script>

<!-- Memos load on demand from an entered userId; the harness renders the lookup form shell. -->
<Story name="Lookup form" />

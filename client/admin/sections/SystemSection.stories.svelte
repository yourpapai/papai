<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import SystemSection from './SystemSection.svelte'

  const { Story } = defineMeta({
    title: 'admin/sections/SystemSection',
    component: SystemSection,
  })
</script>

<Story name="Configured" parameters={{ fixtures: 'admin-populated' }} />

<Story name="Error" parameters={{ fixtures: 'admin-error' }} />

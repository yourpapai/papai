<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import IdentitiesSection from './IdentitiesSection.svelte'

  const { Story } = defineMeta({
    title: 'admin/sections/IdentitiesSection',
    component: IdentitiesSection,
  })
</script>

<!-- Identity mapping loads on demand from an entered userId/provider; render the form shell. -->
<Story name="Lookup form" />

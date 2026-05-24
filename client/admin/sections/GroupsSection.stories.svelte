<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import GroupsSection from './GroupsSection.svelte'

  const { Story } = defineMeta({
    title: 'admin/sections/GroupsSection',
    component: GroupsSection,
  })
</script>

<!-- Groups lazy-load when scrolled into view; under the no-op IntersectionObserver stub the
     section renders its idle shell rather than auto-fetching. -->
<Story name="Idle" />

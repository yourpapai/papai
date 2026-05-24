<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import RemindersSection from './RemindersSection.svelte'

  const { Story } = defineMeta({
    title: 'admin/sections/RemindersSection',
    component: RemindersSection,
  })
</script>

<!-- Recurring/deferred prompts load on demand from an entered userId; render the form shell. -->
<Story name="Lookup form" />

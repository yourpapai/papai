<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import EmptyState from './EmptyState.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/EmptyState',
    component: EmptyState,
  })
</script>

<Story name="No data" args={{ title: 'No recurring reminders', hint: 'Enter a user ID and click Load.' }} />

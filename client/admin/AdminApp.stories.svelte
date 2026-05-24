<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AdminApp from './AdminApp.svelte'

  const { Story } = defineMeta({
    title: 'admin/AdminApp',
    component: AdminApp,
  })
</script>

<Story name="Default" parameters={{ fixtures: 'admin-populated' }} />

<Story name="Empty data" parameters={{ fixtures: 'admin-empty' }} />

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AdminSidebarPanel from './AdminSidebarPanel.svelte'

  const { Story } = defineMeta({
    title: 'admin/components/AdminSidebarPanel',
    component: AdminSidebarPanel,
  })
</script>

<Story name="Overview active" args={{ activeId: 'overview' }} />

<Story name="Billing active" args={{ activeId: 'billing' }} />

<Story name="System active" args={{ activeId: 'system' }} />

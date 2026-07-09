<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AdminMcpPluginServersSection from './AdminMcpPluginServersSection.svelte'

  const { Story } = defineMeta({
    title: 'settings/sections/admin/AdminMcpPluginServersSection',
    component: AdminMcpPluginServersSection,
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'settings-admin-mcp-plugin-servers-populated' }} />

<Story name="Empty" parameters={{ fixtures: 'settings-admin-mcp-plugin-servers-empty' }} />

<Story name="Error" parameters={{ fixtures: 'settings-admin-mcp-plugin-servers-error' }} />

<Story name="Loading" parameters={{ fixtures: 'settings-admin-mcp-plugin-servers-loading' }} />

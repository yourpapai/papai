<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AdminInstancesSection from './AdminInstancesSection.svelte'

  const { Story } = defineMeta({
    title: 'settings/sections/admin/AdminInstancesSection',
    component: AdminInstancesSection,
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'settings-admin-instances-populated' }} />

<Story name="Empty" parameters={{ fixtures: 'settings-admin-instances-empty' }} />

<Story name="Error" parameters={{ fixtures: 'settings-admin-instances-error' }} />

<Story name="Loading" parameters={{ fixtures: 'settings-admin-instances-loading' }} />

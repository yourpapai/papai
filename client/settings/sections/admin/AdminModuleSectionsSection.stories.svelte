<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AdminModuleSectionsSection from './AdminModuleSectionsSection.svelte'

  const { Story } = defineMeta({
    title: 'settings/sections/admin/AdminModuleSectionsSection',
    component: AdminModuleSectionsSection,
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'settings-admin-module-sections-populated' }} />

<Story name="Empty" parameters={{ fixtures: 'settings-admin-module-sections-empty' }} />

<Story name="Error" parameters={{ fixtures: 'settings-admin-module-sections-error' }} />

<Story name="Loading" parameters={{ fixtures: 'settings-admin-module-sections-loading' }} />

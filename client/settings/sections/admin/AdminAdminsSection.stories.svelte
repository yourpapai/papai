<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AdminAdminsSection from './AdminAdminsSection.svelte'

  const { Story } = defineMeta({
    title: 'settings/sections/admin/AdminAdminsSection',
    component: AdminAdminsSection,
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'settings-admin-admins-populated' }} />

<Story name="Empty" parameters={{ fixtures: 'settings-admin-admins-empty' }} />

<Story name="Error" parameters={{ fixtures: 'settings-admin-admins-error' }} />

<Story name="Loading" parameters={{ fixtures: 'settings-admin-admins-loading' }} />

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AdminCodingGuardrailsSection from './AdminCodingGuardrailsSection.svelte'

  const { Story } = defineMeta({
    title: 'settings/sections/admin/AdminCodingGuardrailsSection',
    component: AdminCodingGuardrailsSection,
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'settings-admin-coding-guardrails-populated' }} />

<Story name="Empty" parameters={{ fixtures: 'settings-admin-coding-guardrails-empty' }} />

<Story name="Error" parameters={{ fixtures: 'settings-admin-coding-guardrails-error' }} />

<Story name="Loading" parameters={{ fixtures: 'settings-admin-coding-guardrails-loading' }} />

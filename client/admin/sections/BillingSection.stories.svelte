<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import BillingSection from './BillingSection.svelte'

  const { Story } = defineMeta({
    title: 'admin/sections/BillingSection',
    component: BillingSection,
  })
</script>

<Story name="Populated" parameters={{ fixtures: 'billing-populated' }} />

<Story name="Empty" parameters={{ fixtures: 'billing-empty' }} />

<Story name="Error" parameters={{ fixtures: 'billing-error' }} />

<Story name="Loading" parameters={{ fixtures: 'billing-loading' }} />

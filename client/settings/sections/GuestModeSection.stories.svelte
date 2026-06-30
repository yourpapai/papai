<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import GuestModeSection from './GuestModeSection.svelte'

  const CONTEXT_ID = 'ctx-group-1'

  const { Story } = defineMeta({
    title: 'settings/sections/GuestModeSection',
    component: GuestModeSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<Story name="Enabled" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-guest-mode-populated' }} />

<Story name="Disabled" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-guest-mode-empty' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-guest-mode-error' }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-guest-mode-loading' }} />

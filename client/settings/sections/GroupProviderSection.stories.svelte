<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import GroupProviderSection from './GroupProviderSection.svelte'

  const CONTEXT_ID = 'ctx-group-1'

  const { Story } = defineMeta({
    title: 'settings/sections/GroupProviderSection',
    component: GroupProviderSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<Story name="Populated" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-group-provider-populated' }} />

<!-- no instance bound yet: the Select shows the placeholder, not available[0] -->
<Story
  name="Unassigned"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-group-provider-unassigned' }} />

<!-- bound to an instance with no baseUrl: renders the type-and-id fallback label -->
<Story
  name="NamelessBound"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-group-provider-nameless-bound' }} />

<Story name="Empty" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-group-provider-empty' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-group-provider-error' }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-group-provider-loading' }} />

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import MembersSection from './MembersSection.svelte'

  const CONTEXT_ID = 'ctx-group-1'

  const { Story } = defineMeta({
    title: 'settings/sections/MembersSection',
    component: MembersSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<Story name="Populated" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-members-populated' }} />

<Story name="Empty" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-members-empty' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-members-error' }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-members-loading' }} />

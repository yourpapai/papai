<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import ReposSection from './ReposSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/ReposSection',
    component: ReposSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<Story name="Populated" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-repos-populated' }} />

<Story name="Empty" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-repos-empty' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-repos-error' }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-repos-loading' }} />

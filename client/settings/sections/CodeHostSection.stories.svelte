<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import CodeHostSection from './CodeHostSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/CodeHostSection',
    component: CodeHostSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<!-- CodeHostSection reads /settings/api/coding-credentials (same endpoint as CodingCredentialsSection) -->
<Story
  name="Populated"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-coding-credentials-populated' }}
/>

<Story
  name="Empty"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-coding-credentials-empty' }}
/>

<Story
  name="Error"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-coding-credentials-error' }}
/>

<Story
  name="Loading"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-coding-credentials-loading' }}
/>

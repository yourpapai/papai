<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import CodingMcpSection from './CodingMcpSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/CodingMcpSection',
    component: CodingMcpSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<Story name="Populated" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-coding-mcp-populated' }} />

<Story name="Empty" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-coding-mcp-empty' }} />

<Story
  name="No catalog"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-coding-mcp-no-catalog' }}
/>

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-coding-mcp-error' }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-coding-mcp-loading' }} />

<Story
  name="Internal available"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-coding-mcp-internal-available' }}
/>

<Story
  name="Internal selected"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-coding-mcp-internal-selected' }}
/>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Field from './Field.svelte'
  import Input from './Input.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Field',
    component: Field,
  })
</script>

<Story name="Basic" args={{ label: 'user id' }}>
  {#snippet children()}<input placeholder="auto" />{/snippet}
</Story>

<Story name="Required with hint" args={{ label: 'kaneo url', required: true, hint: 'https only' }}>
  {#snippet children()}<input placeholder="https://…" />{/snippet}
</Story>

<Story name="Invalid" args={{ label: 'user id', required: true, error: 'Provider user ID is required.' }}>
  {#snippet children()}<Input value="" placeholder="e.g. 42" />{/snippet}
</Story>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import FormRow from './FormRow.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/FormRow',
    component: FormRow,
  })
</script>

<Story name="Fields + action">
  {#snippet children()}<input placeholder="id" /><input placeholder="url" />{/snippet}
  {#snippet action()}<button>create</button>{/snippet}
</Story>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Btn from './Btn.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Btn',
    component: Btn,
  })
</script>

<Story name="Default">Click me</Story>

<Story name="Primary" args={{ variant: 'primary' }}>Submit</Story>

<Story name="Outline small" args={{ variant: 'outline', size: 'sm' }}>Filter</Story>

<Story name="Danger disabled" args={{ variant: 'danger', disabled: true }}>Delete</Story>

<Story name="Long label edge"
  >a very long button label that should not wrap unexpectedly inside the surrounding layout</Story>

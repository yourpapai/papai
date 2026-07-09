<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Combobox from './Combobox.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Combobox',
    component: Combobox,
  })
</script>

<Story
  name="With suggestions"
  args={{
    value: '',
    placeholder: 'model id…',
    options: [{ value: 'claude-sonnet-4' }, { value: 'claude-opus-4' }, { value: 'gpt-4o' }],
  }} />

<Story name="Empty" args={{ value: '', placeholder: 'model id…', options: [] }} />

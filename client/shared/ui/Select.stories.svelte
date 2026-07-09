<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Select from './Select.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Select',
    component: Select,
  })
</script>

<Story
  name="Default"
  args={{
    value: '30d',
    options: [
      { value: '1d', label: 'Last day' },
      { value: '7d', label: 'Last 7 days' },
      { value: '30d', label: 'Last 30 days' },
      { value: 'all', label: 'All time' },
    ],
  }} />

<Story name="Single option" args={{ value: 'only', options: [{ value: 'only', label: 'Only choice' }] }} />

<Story
  name="Placeholder"
  args={{
    value: '',
    placeholder: 'Select an option…',
    options: [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ],
  }} />

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Input from './Input.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Input',
    component: Input,
  })
</script>

<Story name="Empty" args={{ value: '', placeholder: 'Search subjects…' }} />

<Story name="Filled" args={{ value: 'telegram', placeholder: 'Search…' }} />

<Story name="Search type" args={{ value: '', placeholder: 'Find', type: 'search' }} />

<Story name="Readonly" args={{ value: 'tg:1001', readonly: true }} />

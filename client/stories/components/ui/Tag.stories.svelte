<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Tag from './Tag.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Tag',
    component: Tag,
  })
</script>

<Story name="Required" args={{ tone: 'required' }}>required</Story>
<Story name="Optional" args={{ tone: 'optional' }}>optional</Story>
<Story name="Neutral">env</Story>
<Story name="Info" args={{ tone: 'info' }}>auto</Story>

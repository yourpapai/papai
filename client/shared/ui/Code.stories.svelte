<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Code from './Code.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Code',
    component: Code,
  })
</script>

<Story name="Inline value">hf:zai-org/GLM-5.1</Story>
<Story name="No truncate" args={{ truncate: false }}>http://kaneo:5173</Story>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Caption from './Caption.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Caption',
    component: Caption,
  })
</script>

<Story name="Default">Last updated 2 minutes ago</Story>

<Story name="Long edge"
  >a much longer caption line that describes some secondary metadata and may need to wrap across the available
  width</Story>

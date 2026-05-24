<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Dot from './Dot.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Dot',
    component: Dot,
  })
</script>

<Story name="Default" />

<Story name="Danger" args={{ color: 'var(--danger)' }} />

<Story name="Large no glow" args={{ size: 14, glow: false }} />

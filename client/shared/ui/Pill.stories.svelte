<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Pill from './Pill.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Pill',
    component: Pill,
  })
</script>

<Story name="Neutral">queued</Story>

<Story name="Accent with dot" args={{ tone: 'accent', dot: true }}>active</Story>

<Story name="Warn with dot" args={{ tone: 'warn', dot: true }}>degraded</Story>

<Story name="Danger" args={{ tone: 'danger', dot: true }}>failed</Story>

<Story name="Info" args={{ tone: 'info' }}>info</Story>

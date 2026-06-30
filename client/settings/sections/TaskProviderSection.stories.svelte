<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import TaskProviderSection from './TaskProviderSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/TaskProviderSection',
    component: TaskProviderSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<!-- both /config and /context/task-instance mocked: instance selector + bind form visible -->
<Story name="Populated" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-shell-ready' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-config-error' }} />

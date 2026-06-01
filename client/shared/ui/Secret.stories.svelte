<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Secret from './Secret.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Secret',
    component: Secret,
  })
</script>

<Story name="Masked with hint" args={{ value: '••••d2a0', hint: '(hidden)' }} />

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import JsonCell from './JsonCell.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/JsonCell',
    component: JsonCell,
  })
</script>

<Story name="Config object" args={{ value: '{"baseUrl":"https://kaneo.drowbridge.uk","internalUrl":"http://kaneo:5173"}' }} />
<Story name="Fallback" args={{ value: 'plain string' }} />

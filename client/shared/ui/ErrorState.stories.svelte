<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import ErrorState from './ErrorState.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/ErrorState',
    component: ErrorState,
  })
</script>

<Story name="With retry" args={{ message: 'Request failed: 500 Internal Server Error', onRetry: () => {} }} />
<Story name="Message only" args={{ message: 'Request failed: 500 Internal Server Error' }} />

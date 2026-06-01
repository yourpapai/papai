<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import StatusPill from './StatusPill.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/StatusPill',
    component: StatusPill,
  })
</script>

<Story name="Active" args={{ status: 'active' }} />
<Story name="Pending" args={{ status: 'pending' }} />
<Story name="Auto" args={{ status: 'auto' }} />
<Story name="Unmatched" args={{ status: 'unmatched' }} />
<Story name="Failed" args={{ status: 'failed' }} />
<Story name="Unknown" args={{ status: 'unknown' }} />

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import PageHeader from './PageHeader.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/PageHeader',
    component: PageHeader,
  })
</script>

<Story name="Eyebrow + title + sub" args={{ eyebrow: 'runtime', title: 'Instances', sub: 'platform · task · admins' }} />
<Story name="Title only" args={{ title: 'System' }} />

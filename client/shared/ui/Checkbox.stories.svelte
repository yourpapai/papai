<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Checkbox from './Checkbox.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Checkbox',
    component: Checkbox,
    args: { label: 'Enabled', checked: true, onChange: () => {} },
  })
</script>

<Story name="On" args={{ checked: true }} />

<Story name="Off" args={{ checked: false }} />

<Story name="Disabled" args={{ checked: true, disabled: true }} />

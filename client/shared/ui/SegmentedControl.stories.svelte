<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import SegmentedControl from './SegmentedControl.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/SegmentedControl',
    component: SegmentedControl,
  })
</script>

<!-- One story only: this file exists to pin the busy frame, and the audit floor
     moves by exactly one baseline for this project. -->
<Story
  name="Busy"
  args={{
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    value: 'on',
    ariaLabel: 'Show tool calls',
    disabled: true,
    busy: true,
    onChange: () => {},
  }} />

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import CopyButton from '../../shared/ui/CopyButton.svelte'
  import { truncateMiddle } from '../lib/truncate-middle.js'

  interface Props {
    value: string
    head?: number
    tail?: number
  }
  let { value, head = 8, tail = 8 }: Props = $props()
  const shown = $derived(truncateMiddle(value, head, tail))
</script>

<span class="id-cell">
  <span class="id-cell__value t-mono-data" title={value}>{shown}</span>
  <CopyButton {value} label="Copy ID" />
</span>

<style>
  .id-cell { display: inline-flex; align-items: center; gap: 6px; }
  .id-cell__value { color: var(--text-muted); }
</style>

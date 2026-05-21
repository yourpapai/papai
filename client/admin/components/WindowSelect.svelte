<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { BillingWindow } from '../../shared/api-types.js'

  interface Props {
    value: BillingWindow
    onChange: (value: BillingWindow) => void
  }

  let { value, onChange }: Props = $props()

  const windows: readonly BillingWindow[] = ['24h', '7d', '30d', 'all']

  function onWindowChange(event: Event): void {
    const target = event.currentTarget
    if (!(target instanceof HTMLSelectElement)) return
    const next = target.value
    if (next === '24h' || next === '7d' || next === '30d' || next === 'all') onChange(next)
  }
</script>

<label>
  Window:
  <select data-testid="billing-window-select" {value} onchange={onWindowChange}>
    {#each windows as window (window)}
      <option value={window}>{window}</option>
    {/each}
  </select>
</label>

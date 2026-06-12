<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Option {
    value: string
    label: string
  }

  interface Props {
    value: string
    options: Option[]
    onChange?: (value: string) => void
    testid?: string
  }

  let { value, options, onChange, testid }: Props = $props()

  function handleChange(event: Event): void {
    onChange?.((event.target as HTMLSelectElement).value)
  }
</script>

<div class="ui-select">
  <select {value} onchange={handleChange} data-testid={testid}>
    {#each options as opt (opt.value)}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
  <span class="ui-select__caret">▾</span>
</div>

<style>
  .ui-select {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--raised);
    border: 1px solid var(--border);
    padding: 4px 8px 4px 10px;
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
  }
  .ui-select select {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--fg);
    font: inherit;
    appearance: none;
  }
  .ui-select__caret {
    color: var(--fg3);
    font-size: 10px;
    pointer-events: none;
  }
</style>

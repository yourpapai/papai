<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { getFieldLabelId } from './field-context.js'

  interface Option {
    value: string
    label: string
  }

  interface Props {
    value: string
    options: Option[]
    onChange?: (value: string) => void
    testid?: string
    disabled?: boolean
    placeholder?: string
  }

  let { value, options, onChange, testid, disabled = false, placeholder }: Props = $props()

  const labelId = getFieldLabelId()

  function handleChange(event: Event): void {
    onChange?.((event.target as HTMLSelectElement).value)
  }
</script>

<div class="ui-select" class:ui-select--disabled={disabled}>
  <select {value} {disabled} onchange={handleChange} aria-labelledby={labelId} data-testid={testid}>
    {#if placeholder}
      <option value="" disabled>{placeholder}</option>
    {/if}
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
  .ui-select:focus-within {
    outline: 2px solid rgba(82, 224, 138, 0.4);
    outline-offset: 1px;
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
  .ui-select--disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>

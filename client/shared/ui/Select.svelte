<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { getFieldLabelId, useFieldInvalid } from './field-context.js'

  interface Option {
    value: string
    label: string
  }

  /** An <optgroup>: a labelled cluster of options. Mutually exclusive with `options`. */
  interface OptionGroup {
    label: string
    options: Option[]
  }

  interface Props {
    value: string
    options?: Option[]
    groups?: OptionGroup[]
    onChange?: (value: string) => void
    testid?: string
    disabled?: boolean
    placeholder?: string
    /** Full-width control at row height, for a select that owns its line. */
    block?: boolean
  }

  let { value, options, groups, onChange, testid, disabled = false, placeholder, block = false }: Props = $props()

  const labelId = getFieldLabelId()
  const fieldError = useFieldInvalid()

  function handleChange(event: Event): void {
    onChange?.((event.target as HTMLSelectElement).value)
  }
</script>

<div
  class="ui-select"
  class:ui-select--block={block}
  class:ui-select--disabled={disabled}
  class:ui-select--invalid={fieldError.invalid}>
  <select
    {value}
    {disabled}
    onchange={handleChange}
    aria-labelledby={labelId}
    aria-invalid={fieldError.invalid ? 'true' : undefined}
    aria-required={fieldError.required ? 'true' : undefined}
    aria-describedby={fieldError.describedBy}
    data-testid={testid}>
    {#if placeholder}
      <option value="" disabled>{placeholder}</option>
    {/if}
    {#if groups !== undefined}
      {#each groups as group (group.label)}
        <optgroup label={group.label}>
          {#each group.options as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </optgroup>
      {/each}
    {:else}
      {#each options ?? [] as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    {/if}
  </select>
  <span class="ui-select__caret">▾</span>
</div>

<style>
  .ui-select {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 4px 8px 4px 10px;
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
  }
  .ui-select--block {
    display: flex;
    width: 100%;
    height: var(--row-h);
    font-size: 14px;
  }
  .ui-select--block select {
    flex: 1;
  }
  .ui-select:focus-within {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
  .ui-select select {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--text);
    font: inherit;
    appearance: none;
  }
  .ui-select__caret {
    color: var(--text-dim);
    font-size: 10px;
    pointer-events: none;
  }
  .ui-select--disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .ui-select--invalid {
    border-color: var(--danger);
  }
</style>

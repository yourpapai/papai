<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  // Per-instance sequence for a stable datalist id, mirroring Field/SettingsFieldShell.
  let seq = 0
</script>

<script lang="ts">
  import { getFieldLabelId } from './field-context.js'

  interface Option {
    value: string
    label?: string
  }

  interface Props {
    value: string
    options?: Option[]
    onInput?: (value: string) => void
    placeholder?: string
    disabled?: boolean
    testid?: string
  }

  let { value, options = [], onInput, placeholder, disabled = false, testid }: Props = $props()

  const labelId = getFieldLabelId()
  const listId = `ui-combobox-${++seq}`

  function handleInput(event: Event): void {
    onInput?.((event.target as HTMLInputElement).value)
  }
</script>

<div class="ui-combobox" class:ui-combobox--disabled={disabled}>
  <input
    list={listId}
    {value}
    {placeholder}
    {disabled}
    aria-labelledby={labelId}
    data-testid={testid}
    oninput={handleInput} />
  <datalist id={listId}>
    {#each options as opt (opt.value)}
      <option value={opt.value}></option>
    {/each}
  </datalist>
</div>

<style>
  .ui-combobox {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 200px;
    background: var(--raised);
    border: 1px solid var(--border);
    padding: 0 10px;
    border-radius: var(--radius-control);
  }
  .ui-combobox:focus-within {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
  .ui-combobox input {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    flex: 1;
    padding: 6px 0;
  }
  .ui-combobox--disabled {
    opacity: 0.6;
  }
</style>

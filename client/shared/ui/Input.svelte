<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  import { getFieldLabelId, useFieldInvalid } from './field-context.js'

  interface Props {
    value: string
    placeholder?: string
    prefix?: Snippet
    onInput?: (value: string) => void
    onBlur?: () => void
    type?: 'text' | 'search' | 'password'
    readonly?: boolean
    disabled?: boolean
    testid?: string
    multiline?: boolean
    rows?: number
  }

  let {
    value,
    placeholder,
    prefix,
    onInput,
    onBlur,
    type = 'text',
    readonly = false,
    disabled = false,
    testid,
    multiline = false,
    rows = 3,
  }: Props = $props()

  const labelId = getFieldLabelId()
  const fieldError = useFieldInvalid()

  function handleInput(event: Event): void {
    if (disabled) return
    const next = (event.target as HTMLInputElement | HTMLTextAreaElement).value
    onInput?.(next)
  }
</script>

<div
  class="ui-input"
  class:ui-input--multiline={multiline}
  class:ui-input--disabled={disabled}
  class:ui-input--invalid={fieldError.invalid}
>
  {#if multiline}
    <textarea
      {placeholder}
      {value}
      {readonly}
      {disabled}
      {rows}
      aria-labelledby={labelId}
      aria-invalid={fieldError.invalid ? 'true' : undefined}
      aria-required={fieldError.required ? 'true' : undefined}
      aria-describedby={fieldError.describedBy}
      data-testid={testid}
      oninput={handleInput}
      onblur={onBlur}
    ></textarea>
  {:else}
    {#if prefix}
      <span class="ui-input__prefix">{@render prefix()}</span>
    {/if}
    <input
      {type}
      {placeholder}
      {value}
      {readonly}
      {disabled}
      aria-labelledby={labelId}
      aria-invalid={fieldError.invalid ? 'true' : undefined}
      aria-required={fieldError.required ? 'true' : undefined}
      aria-describedby={fieldError.describedBy}
      data-testid={testid}
      oninput={handleInput}
      onblur={onBlur} />
  {/if}
</div>

<style>
  .ui-input {
    display: flex;
    align-items: center;
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 0 10px;
    border-radius: var(--radius-control);
  }
  .ui-input:focus-within {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
  .ui-input--invalid {
    border-color: var(--danger);
  }
  .ui-input--disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .ui-input__prefix {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
    margin-right: 8px;
  }
  .ui-input input {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    flex: 1;
    padding: 6px 0;
  }
  .ui-input--multiline {
    align-items: stretch;
  }
  .ui-input textarea {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    flex: 1;
    padding: 6px 0;
    resize: vertical;
  }
</style>

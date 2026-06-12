<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    value: string
    placeholder?: string
    prefix?: Snippet
    onInput?: (value: string) => void
    type?: 'text' | 'search' | 'password'
    readonly?: boolean
    testid?: string
    multiline?: boolean
    rows?: number
  }

  let {
    value,
    placeholder,
    prefix,
    onInput,
    type = 'text',
    readonly = false,
    testid,
    multiline = false,
    rows = 3,
  }: Props = $props()

  function handleInput(event: Event): void {
    const next = (event.target as HTMLInputElement | HTMLTextAreaElement).value
    onInput?.(next)
  }
</script>

<div class="ui-input" class:ui-input--multiline={multiline}>
  {#if multiline}
    <textarea {placeholder} {value} {readonly} {rows} data-testid={testid} oninput={handleInput}></textarea>
  {:else}
    {#if prefix}
      <span class="ui-input__prefix">{@render prefix()}</span>
    {/if}
    <input {type} {placeholder} {value} {readonly} data-testid={testid} oninput={handleInput} />
  {/if}
</div>

<style>
  .ui-input {
    display: flex;
    align-items: center;
    background: var(--raised);
    border: 1px solid var(--border);
    padding: 0 10px;
    border-radius: 2px;
  }
  .ui-input__prefix {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    margin-right: 8px;
  }
  .ui-input input {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--fg);
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
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    flex: 1;
    padding: 6px 0;
    resize: vertical;
  }
</style>

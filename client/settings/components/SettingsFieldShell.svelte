<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    required?: boolean
    testid?: string
    // Whether to render the editor slot. Consumers pass their own open/closed logic
    // (masked-resting secret fields render `head` only). Defaults to true.
    editorOpen?: boolean
    head?: Snippet
    editor?: Snippet
    footer?: Snippet
  }

  let { label, required = false, testid, editorOpen = true, head, editor, footer }: Props = $props()
</script>

<div class="settings-field" data-testid={testid}>
  <div class="settings-field__head">
    <span class="settings-field__label">{label}{#if required}<span class="settings-field__req">*</span>{/if}</span>
    {@render head?.()}
  </div>
  {#if editor && editorOpen}
    <div class="settings-field__editor">{@render editor()}</div>
  {/if}
  {@render footer?.()}
</div>

<style>
  .settings-field {
    display: grid;
    gap: var(--gap-tight);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-1);
  }
  .settings-field__head {
    display: flex;
    align-items: center;
    gap: var(--gap-tight);
    flex-wrap: wrap;
  }
  .settings-field__label {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    margin-right: auto;
  }
  .settings-field__req {
    color: var(--accent);
    margin-left: 5px;
  }
  .settings-field__editor {
    display: flex;
    align-items: end;
    gap: var(--gap-tight);
    flex-wrap: wrap;
  }
  .settings-field__editor :global(.ui-input) {
    flex: 1;
    min-width: 200px;
  }
</style>

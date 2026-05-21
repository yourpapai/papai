<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    open: boolean
    title: string
    onClose: () => void
    body: Snippet
    size: 'sm' | 'md' | 'lg' | 'xl' | undefined
    footer: Snippet | undefined
  }

  let { open, title, onClose, body, size, footer }: Props = $props()

  const sizeClass = $derived(size === undefined ? 'md' : size)

  function onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) onClose()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="modal" onclick={onBackdropClick} role="presentation">
    <div class={`modal-content modal--${sizeClass}`}>
      <div class="modal-header">
        <h3>{title}</h3>
        <button class="modal-close" aria-label="Close" onclick={onClose}>×</button>
      </div>
      <div class="modal-body">
        {@render body()}
      </div>
      {#if footer}
        <div class="modal-footer">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}

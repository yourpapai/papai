<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  type Size = 'sm' | 'md' | 'lg'

  interface Props {
    children: Snippet
    icon?: Snippet
    variant?: Variant
    size?: Size
    onClick?: () => void
    type?: 'button' | 'submit'
    disabled?: boolean
    busy?: boolean
    testid?: string
    ariaLabel?: string
    ariaPressed?: boolean
    ariaDescribedBy?: string
  }

  let {
    children,
    icon,
    variant = 'secondary',
    size = 'md',
    onClick,
    type = 'button',
    disabled = false,
    busy = false,
    testid,
    ariaLabel,
    ariaPressed,
    ariaDescribedBy,
  }: Props = $props()

  function handleClick(): void {
    if (busy) return
    onClick?.()
  }
</script>

<button
  class="ui-btn ui-btn--{variant} ui-btn--{size}"
  class:ui-btn--busy={busy}
  {type}
  {disabled}
  aria-busy={busy}
  aria-label={ariaLabel}
  aria-pressed={ariaPressed}
  aria-describedby={ariaDescribedBy}
  onclick={handleClick}
  data-testid={testid}
>
  {#if icon}<span class="ui-btn__icon">{@render icon()}</span>{/if}
  {@render children()}
</button>

<style>
  .ui-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-weight: 500;
    cursor: pointer;
    border-radius: var(--radius-control);
    border: 1px solid transparent;
  }
  .ui-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ui-btn.ui-btn--busy {
    opacity: 0.6;
    pointer-events: none;
  }
  .ui-btn:focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }

  .ui-btn--primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .ui-btn--secondary {
    background: var(--surface-2);
    color: var(--text);
    border-color: var(--border);
  }
  .ui-btn--outline {
    background: transparent;
    color: var(--text);
    border-color: var(--border);
  }
  .ui-btn--ghost {
    background: transparent;
    color: var(--text-muted);
    border-color: transparent;
  }
  .ui-btn--danger {
    background: transparent;
    color: var(--danger);
    border-color: rgba(232, 92, 92, 0.3);
  }

  .ui-btn--sm {
    padding: 3px 8px;
    font-size: 11px;
    height: var(--control-h-sm);
  }
  .ui-btn--md {
    padding: 5px 12px;
    font-size: 12px;
    height: var(--control-h-md);
  }
  .ui-btn--lg {
    padding: 8px 16px;
    font-size: 13px;
    height: var(--control-h-lg);
  }

  .ui-btn--primary:hover:not(:disabled) {
    background: #7be595;
    border-color: #7be595;
  }
  .ui-btn--secondary:hover:not(:disabled) {
    background: var(--strong);
  }
  .ui-btn--outline:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .ui-btn--ghost:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .ui-btn--danger:hover:not(:disabled) {
    background: var(--danger-soft);
  }

  .ui-btn__icon {
    display: inline-flex;
    align-items: center;
  }
</style>

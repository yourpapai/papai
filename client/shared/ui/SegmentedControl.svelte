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
    options: readonly Option[]
    value: string
    ariaLabel: string
    onChange: (value: string) => void
    testidPrefix?: string
    disabled?: boolean
    ariaDescribedBy?: string
  }
  let { options, value, ariaLabel, onChange, testidPrefix, disabled = false, ariaDescribedBy }: Props = $props()

  function onKey(event: KeyboardEvent, index: number): void {
    if (disabled) return
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    onChange(options[(index + delta + options.length) % options.length]!.value)
  }
</script>

<div class="ui-seg" role="radiogroup" aria-label={ariaLabel} aria-describedby={ariaDescribedBy}>
  {#each options as opt, i (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value ? 'true' : 'false'}
      tabindex={value === opt.value ? 0 : -1}
      class="ui-seg__opt"
      class:ui-seg__opt--on={value === opt.value}
      {disabled}
      data-testid={testidPrefix ? `${testidPrefix}-${opt.value}` : undefined}
      onclick={() => onChange(opt.value)}
      onkeydown={(e) => onKey(e, i)}>
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .ui-seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    overflow: hidden;
  }
  .ui-seg__opt {
    background: var(--surface-2);
    border: 0;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 0 10px;
    height: 22px;
  }
  .ui-seg__opt:last-child { border-right: 0; }
  .ui-seg__opt:focus-visible {
    outline: var(--focus-ring);
    outline-offset: -2px;
  }
  .ui-seg__opt:hover:not(:disabled) { color: var(--text); background: var(--surface-hover); }
  .ui-seg__opt:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .ui-seg__opt--on {
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
  }
</style>

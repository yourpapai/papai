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
  }
  let { options, value, ariaLabel, onChange, testidPrefix }: Props = $props()

  function onKey(event: KeyboardEvent, index: number): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    onChange(options[(index + delta + options.length) % options.length]!.value)
  }
</script>

<div class="ui-seg" role="radiogroup" aria-label={ariaLabel}>
  {#each options as opt, i (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value ? 'true' : 'false'}
      tabindex={value === opt.value ? 0 : -1}
      class="ui-seg__opt"
      class:ui-seg__opt--on={value === opt.value}
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
    border-radius: var(--radius);
    overflow: hidden;
  }
  .ui-seg__opt {
    background: var(--surface-2);
    border: 0;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 12px;
    height: 26px;
  }
  .ui-seg__opt:last-child { border-right: 0; }
  .ui-seg__opt:hover { color: var(--text); background: var(--surface-hover); }
  .ui-seg__opt--on {
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
  }
</style>

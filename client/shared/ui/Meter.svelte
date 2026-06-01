<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  type Tone = 'accent' | 'warn' | 'danger' | 'info'

  interface Props {
    label: string
    value: number
    total: number
    suffix?: string
    tone?: Tone
  }

  let { label, value, total, suffix, tone = 'accent' }: Props = $props()

  const safeTotal = $derived(total > 0 ? total : 0)
  const over = $derived(safeTotal > 0 && value > safeTotal)
  const pct = $derived(safeTotal > 0 ? Math.max(0, Math.min(100, (value / safeTotal) * 100)) : 0)
  const fillTone = $derived(over ? 'warn' : tone)
  const suffixText = $derived(suffix !== undefined ? suffix : safeTotal ? `/${safeTotal}` : '')
</script>

<div class="ui-meter">
  <div class="ui-meter__head">
    <span class="ui-meter__label">{label}</span>
    <span class="ui-meter__value" class:ui-meter__value--over={over}>
      {value}<span class="ui-meter__suffix">{suffixText}</span>
    </span>
  </div>
  <div class="ui-meter__track">
    <div class="ui-meter__fill ui-meter__fill--{fillTone}" style:width="{pct}%"></div>
  </div>
</div>

<style>
  .ui-meter__head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 5px;
  }
  .ui-meter__label {
    font-size: 12px;
    color: var(--fg2);
  }
  .ui-meter__value {
    font-size: 12px;
    color: var(--fg);
  }
  .ui-meter__value--over {
    color: var(--warn);
  }
  .ui-meter__suffix {
    color: var(--fg3);
  }
  .ui-meter__track {
    height: 5px;
    background: var(--inset);
    position: relative;
    overflow: hidden;
  }
  .ui-meter__fill {
    position: absolute;
    inset: 0;
    width: 0;
  }
  .ui-meter__fill--accent {
    background: var(--accent);
  }
  .ui-meter__fill--warn {
    background: var(--warn);
  }
  .ui-meter__fill--danger {
    background: var(--danger);
  }
  .ui-meter__fill--info {
    background: var(--info);
  }
</style>

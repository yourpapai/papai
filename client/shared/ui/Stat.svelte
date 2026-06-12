<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Caption from './Caption.svelte'

  interface Props {
    label: string
    value: number | string
    of?: number
  }

  let { label, value, of }: Props = $props()

  const over = $derived(typeof value === 'number' && typeof of === 'number' && value > of)
</script>

<div class="ui-stat">
  <Caption>{label}</Caption>
  <div class="ui-stat__value" class:ui-stat__value--over={over}>{value}</div>
  {#if of !== undefined}
    <div class="ui-stat__of" class:ui-stat__of--over={over}>of {of}{#if over} · exceeds total{/if}</div>
  {/if}
</div>

<style>
  .ui-stat {
    padding: 14px 16px;
  }
  .ui-stat__value {
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 600;
    color: var(--fg);
    margin-top: 6px;
    letter-spacing: -0.02em;
  }
  .ui-stat__value--over {
    color: var(--warn);
  }
  .ui-stat__of {
    font-size: 11px;
    color: var(--fg3);
    margin-top: 4px;
  }
  .ui-stat__of--over {
    color: var(--warn);
  }
</style>

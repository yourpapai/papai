<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    value: string | number | Snippet
    sub?: string
    accent?: string
  }

  let { label, value, sub, accent }: Props = $props()
</script>

<div class="ui-metric-card">
  <div class="ui-metric-card__label">{label}</div>
  <div class="ui-metric-card__value" style:color={accent ?? 'var(--fg)'}>
    {#if typeof value === 'function'}
      {@render (value as Snippet)()}
    {:else}
      {value}
    {/if}
  </div>
  {#if sub !== undefined}
    <div class="ui-metric-card__sub">{sub}</div>
  {/if}
</div>

<style>
  .ui-metric-card {
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    min-width: 0;
  }
  .ui-metric-card__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .ui-metric-card__value {
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin-top: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ui-metric-card__sub {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg3);
    margin-top: 4px;
  }
</style>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    k: string
    v: string | number | Snippet
    sub?: string
    vColor?: string
    dim?: boolean
  }

  let { k, v, sub, vColor, dim = false }: Props = $props()
</script>

<div class="ui-kv" class:ui-kv--stacked={sub !== undefined}>
  <span class="ui-kv__k" style:color={dim ? 'var(--fg4)' : 'var(--fg3)'}>{k}</span>
  <span class="ui-kv__v" style:color={vColor ?? 'var(--fg)'}>
    {#if typeof v === 'function'}
      {@render (v as Snippet)()}
    {:else}
      {v}
    {/if}
  </span>
  {#if sub !== undefined}
    <span class="ui-kv__sub">{sub}</span>
  {/if}
</div>

<style>
  .ui-kv {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .ui-kv--stacked {
    flex-wrap: wrap;
  }

  .ui-kv__v {
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ui-kv__sub {
    flex: 1 0 100%;
    text-align: right;
    color: var(--fg4);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>

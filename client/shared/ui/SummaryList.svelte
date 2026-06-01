<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import StatusPill from './StatusPill.svelte'

  interface Item {
    k: string
    v: string
    pill?: boolean
    vColor?: string
  }

  interface Props {
    items: Item[]
    cols?: number
  }

  let { items, cols = 1 }: Props = $props()
</script>

<div class="ui-summary" style:grid-template-columns="repeat({cols}, 1fr)">
  {#each items as it (it.k)}
    <div class="ui-summary__row">
      <span class="ui-summary__k">{it.k}</span>
      <span class="ui-summary__v" style:color={it.vColor ?? null}>
        {#if it.pill}<StatusPill status={it.v} />{:else}{it.v}{/if}
      </span>
    </div>
  {/each}
</div>

<style>
  .ui-summary {
    display: grid;
    column-gap: 32px;
  }
  .ui-summary__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
    border-bottom: 1px solid var(--hair);
  }
  .ui-summary__k {
    font-size: 12px;
    color: var(--fg3);
  }
  .ui-summary__v {
    font-size: 12px;
    color: var(--fg);
    text-align: right;
  }
</style>

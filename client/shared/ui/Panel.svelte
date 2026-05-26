<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title?: string
    count?: string | number
    body: Snippet
    action?: Snippet
    dense?: boolean
    flat?: boolean
    pad?: number
  }

  let { title, count, body, action, dense = false, flat = false, pad }: Props = $props()
</script>

<div class="ui-panel" class:ui-panel--flat={flat}>
  {#if title !== undefined}
    <div class="ui-panel__header" class:ui-panel__header--dense={dense}>
      <div class="ui-panel__header-left">
        <span class="ui-panel__title">{title}</span>
        {#if count !== undefined}
          <span class="ui-panel__count">{count}</span>
        {/if}
      </div>
      {#if action}
        <div class="ui-panel__action">{@render action()}</div>
      {/if}
    </div>
  {/if}
  <div class="ui-panel__body" style:padding={pad !== undefined ? `${pad}px` : null}>{@render body()}</div>
</div>

<style>
  .ui-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .ui-panel--flat {
    background: transparent;
  }
  .ui-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--hair);
    gap: 12px;
    flex-shrink: 0;
  }
  .ui-panel__header--dense {
    padding: 8px 12px;
  }
  .ui-panel__header-left {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .ui-panel__title {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg2);
  }
  .ui-panel__count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg3);
  }
  .ui-panel__action {
    display: flex;
    gap: 6px;
  }
  .ui-panel__body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>

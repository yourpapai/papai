<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    page: string
    statusRow?: Snippet
    secondaryRow?: Snippet
  }

  let { page, statusRow, secondaryRow }: Props = $props()
</script>

<div class="ui-topbar">
  <div class="ui-topbar__primary">
    <div class="ui-topbar__brand">
      <span class="ui-topbar__brand-name">papai</span>
      <span class="ui-topbar__brand-page">::{page}</span>
    </div>
    <div class="ui-topbar__spacer"></div>
    {#if statusRow}
      <div class="ui-topbar__status">{@render statusRow()}</div>
    {/if}
  </div>
  {#if secondaryRow}
    <div class="ui-topbar__secondary">{@render secondaryRow()}</div>
  {/if}
</div>

<style>
  .ui-topbar {
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .ui-topbar__primary {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
  }
  .ui-topbar__brand {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .ui-topbar__brand-name {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 700;
    color: var(--fg);
    letter-spacing: -0.01em;
  }
  .ui-topbar__brand-page {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--accent);
    font-weight: 600;
  }
  .ui-topbar__spacer {
    flex: 1;
  }
  .ui-topbar__secondary {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    border-top: 1px solid var(--hair);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
  }
</style>

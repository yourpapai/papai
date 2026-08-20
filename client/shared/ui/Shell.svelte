<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    topBar: Snippet
    children: Snippet
    /**
     * Whether this shell's body owns the page scroll. Set false when the page
     * content manages its own scroll regions, so nothing nests a second scroller
     * inside a box whose height it cannot express.
     */
    bodyScroll?: boolean
  }

  let { topBar, children, bodyScroll = true }: Props = $props()
</script>

<div class="ui-shell">
  <div class="ui-shell__topbar">{@render topBar()}</div>
  <div class="ui-shell__body" class:ui-shell__body--fixed={!bodyScroll}>{@render children()}</div>
</div>

<style>
  .ui-shell {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ui-shell__topbar {
    flex: 0 0 auto;
  }
  .ui-shell__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
  }
  .ui-shell__body--fixed {
    overflow: hidden;
    padding: 0;
  }
</style>

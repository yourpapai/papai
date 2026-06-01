<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    topBar: Snippet
    children: Snippet
  }

  let { topBar, children }: Props = $props()
</script>

<div class="ui-shell">
  <div class="ui-shell__topbar">{@render topBar()}</div>
  <div class="ui-shell__body">{@render children()}</div>
</div>

<style>
  .ui-shell {
    background: var(--bg);
    color: var(--fg);
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
</style>

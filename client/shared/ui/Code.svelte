<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
    truncate?: boolean
    max?: number
  }

  let { children, truncate = true, max = 320 }: Props = $props()
</script>

<span
  class="ui-code"
  class:ui-code--truncate={truncate}
  style:max-width={truncate ? `${max}px` : null}
>{@render children()}</span>

<style>
  .ui-code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
    background: var(--inset);
    border: 1px solid var(--hair);
    padding: 3px 8px;
    border-radius: 2px;
    display: inline-block;
  }
  .ui-code--truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
</style>

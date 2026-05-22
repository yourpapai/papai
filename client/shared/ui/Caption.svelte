<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
  }

  let { children }: Props = $props()
</script>

<div
  class="ui-caption"
  style:text-transform="uppercase"
  style:letter-spacing="0.1em"
>
  {@render children()}
</div>

<style>
  .ui-caption {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--fg3);
  }
</style>

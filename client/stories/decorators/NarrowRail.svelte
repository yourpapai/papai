<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
</script>

<div class="narrow-rail">
  {@render children?.()}
</div>

<style>
  .narrow-rail {
    width: 320px;
    max-width: 100%;
    padding: 20px;
    background: var(--bg);
  }
</style>

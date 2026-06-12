<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
    action?: Snippet
  }

  let { children, action }: Props = $props()
</script>

<div class="ui-form-row">
  {@render children()}
  {#if action}<div class="ui-form-row__action">{@render action()}</div>{/if}
</div>

<style>
  .ui-form-row {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .ui-form-row__action {
    flex-shrink: 0;
  }
</style>

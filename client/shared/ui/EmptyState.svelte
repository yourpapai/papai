<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    icon?: string
    hint?: string
    action?: Snippet
  }

  let { title, icon = '∅', hint, action }: Props = $props()
</script>

<div class="ui-empty">
  <div class="ui-empty__icon">{icon}</div>
  <div class="ui-empty__title">{title}</div>
  {#if hint}<div class="ui-empty__hint">{hint}</div>{/if}
  {#if action}<div class="ui-empty__action">{@render action()}</div>{/if}
</div>

<style>
  .ui-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 36px 24px;
    text-align: center;
    min-height: 120px;
  }
  .ui-empty__icon {
    font-size: 22px;
    color: var(--fg4);
    line-height: 1;
  }
  .ui-empty__title {
    font-size: 13px;
    color: var(--fg2);
  }
  .ui-empty__hint {
    font-size: 11px;
    color: var(--fg3);
    max-width: 320px;
  }
  .ui-empty__action {
    margin-top: 6px;
  }
</style>

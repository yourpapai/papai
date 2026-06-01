<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  import Caption from './Caption.svelte'

  interface Props {
    title: string
    eyebrow?: string
    sub?: string
    action?: Snippet
    titleTestId?: string
  }

  let { title, eyebrow, sub, action, titleTestId }: Props = $props()
</script>

<div class="ui-page-header">
  <div class="ui-page-header__text">
    {#if eyebrow}<Caption>{eyebrow}</Caption>{/if}
    <div class="ui-page-header__title" data-testid={titleTestId}>{title}</div>
    {#if sub}<div class="ui-page-header__sub">{sub}</div>{/if}
  </div>
  {#if action}<div class="ui-page-header__action">{@render action()}</div>{/if}
</div>

<style>
  .ui-page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin: 4px 0 14px;
  }
  .ui-page-header__text {
    min-width: 0;
  }
  .ui-page-header__title {
    font-family: var(--font-mono);
    font-size: 20px;
    font-weight: 700;
    color: var(--fg);
    letter-spacing: -0.02em;
  }
  .ui-page-header__sub {
    font-size: 11px;
    color: var(--fg3);
    margin-top: 4px;
  }
  .ui-page-header__action {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
</style>

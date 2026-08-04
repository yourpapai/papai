<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from './Btn.svelte'

  const PLACEHOLDER = '••••••••'

  interface Props {
    value?: string
    hint?: string
    onReveal?: () => void
  }

  let { value = PLACEHOLDER, hint, onReveal }: Props = $props()

  // A Svelte prop default fires only when the prop is `undefined`, so an explicit ''
  // slipped past it and rendered a blank pill. Defense-in-depth: no current route can
  // emit an empty masked secret (src/config.ts:144-146 always returns `****xxxx`).
  const shown = $derived(value === '' ? PLACEHOLDER : value)
</script>

<span class="ui-secret">
  <span class="ui-secret__value">{shown}</span>
  {#if hint}<span class="ui-secret__hint">{hint}</span>{/if}
  {#if onReveal}
    <Btn size="sm" variant="ghost" onClick={onReveal}>reveal</Btn>
  {/if}
</span>

<style>
  .ui-secret {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .ui-secret__value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    letter-spacing: 0.1em;
    background: var(--inset);
    border: 1px solid var(--border);
    padding: 3px 10px;
    border-radius: 2px;
  }
  .ui-secret__hint {
    font-size: 10px;
    color: var(--text-dim);
  }
</style>

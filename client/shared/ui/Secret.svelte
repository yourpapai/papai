<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from './Btn.svelte'

  interface Props {
    value?: string
    hint?: string
    onReveal?: () => void
  }

  let { value = '••••••••', hint, onReveal }: Props = $props()
</script>

<span class="ui-secret">
  <span class="ui-secret__value">{value}</span>
  {#if hint}<span class="ui-secret__hint">{hint}</span>{/if}
  <Btn size="sm" variant="ghost" onClick={onReveal}>reveal</Btn>
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
    color: var(--fg2);
    letter-spacing: 0.1em;
    background: var(--inset);
    border: 1px solid var(--hair);
    padding: 3px 10px;
    border-radius: 2px;
  }
  .ui-secret__hint {
    font-size: 10px;
    color: var(--fg4);
  }
</style>

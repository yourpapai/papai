<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    options: string[]
    value: string
    onChange?: (value: string) => void
  }

  let { options, value, onChange }: Props = $props()
</script>

<div class="ui-seg">
  {#each options as opt (opt)}
    <button
      type="button"
      class="ui-seg__btn"
      class:ui-seg__btn--active={opt === value}
      onclick={() => onChange?.(opt)}
    >{opt}</button>
  {/each}
</div>

<style>
  .ui-seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
    padding: 2px;
  }
  .ui-seg__btn {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    color: var(--fg3);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .ui-seg__btn--active {
    color: var(--fg);
    background: var(--raised);
    border-color: var(--hair);
  }
</style>

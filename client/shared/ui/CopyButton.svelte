<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    value: string
    label?: string
  }
  let { value, label = 'Copy' }: Props = $props()
  let done = $state(false)

  async function copy(): Promise<void> {
    if (navigator.clipboard === undefined) { done = false; return }
    try {
      await navigator.clipboard.writeText(value)
      done = true
      setTimeout(() => {
        done = false
      }, 2000)
    } catch {
      done = false
    }
  }
</script>

<button type="button" class="ui-copy" aria-label={label} title={label} onclick={() => void copy()}>
  {done ? '✓' : '⧉'}
</button>

<style>
  .ui-copy {
    background: transparent; border: 0; cursor: pointer;
    color: var(--text-dim); font-family: var(--font-mono); font-size: 12px; padding: 2px 4px;
  }
  .ui-copy:hover { color: var(--text); }
</style>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    label: string
    glyph: string
    onClick?: () => void
    busy?: boolean
    testid?: string
  }
  let { label, glyph, onClick, busy = false, testid }: Props = $props()
</script>

<button
  type="button"
  class="ui-iconbtn"
  class:ui-iconbtn--busy={busy}
  aria-label={label}
  title={label}
  data-testid={testid}
  onclick={onClick}>
  {glyph}
</button>

<style>
  .ui-iconbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .ui-iconbtn:hover { color: var(--text); background: var(--surface-hover); }
  .ui-iconbtn--busy { opacity: 0.6; pointer-events: none; }
</style>

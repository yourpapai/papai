<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    k: string
    v: string | number
    vColor?: string
    dim?: boolean
  }

  let { k, v, vColor, dim = false }: Props = $props()
</script>

<div class="ui-kv">
  <span class="ui-kv__k" style:color={dim ? 'var(--fg4)' : 'var(--fg3)'}>{k}</span>
  <span class="ui-kv__v" style:color={vColor ?? 'var(--fg)'}>{v}</span>
</div>

<style>
  .ui-kv {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .ui-kv__v {
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

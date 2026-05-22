<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    color?: string
    size?: number
    glow?: boolean
  }

  let { color = 'var(--accent)', size = 6, glow = true }: Props = $props()
</script>

<span
  class="ui-dot"
  style:width="{size}px"
  style:height="{size}px"
  style:background={color}
  style:box-shadow={glow ? `0 0 6px ${color}` : 'none'}
></span>

<style>
  .ui-dot {
    display: inline-block;
    border-radius: 999px;
    flex-shrink: 0;
  }
</style>

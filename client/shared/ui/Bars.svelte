<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    data: number[]
    width?: number
    height?: number
    color?: string
  }

  let { data, width = 240, height = 56, color = 'var(--accent)' }: Props = $props()

  const max = $derived(Math.max(...data, 1))
  const bw = $derived(data.length > 0 ? width / data.length : 0)
</script>

<svg {width} {height} class="ui-bars">
  {#each data as v, i (i)}
    {@const h = (v / max) * (height - 4)}
    <rect x={i * bw + 1} y={height - h} width={bw - 2} height={h} fill={color} fill-opacity="0.85" />
  {/each}
</svg>

<style>
  .ui-bars {
    display: block;
  }
</style>

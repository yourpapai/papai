<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    data: number[] | undefined
    width?: number
    height?: number
    color?: string
  }

  let { data, width, height = 56, color = 'var(--accent)' }: Props = $props()

  const safeData = $derived(data ?? [])
  const max = $derived(Math.max(...safeData, 1))
  const intrinsicW = $derived(width ?? Math.max(safeData.length * 10, 100))
  const bw = $derived(safeData.length > 0 ? intrinsicW / safeData.length : 0)
</script>

{#if width !== undefined}
  <svg {width} {height} class="ui-bars" aria-hidden="true">
    {#each safeData as v, i (i)}
      {@const h = (v / max) * (height - 4)}
      <rect x={i * bw + 1} y={height - h} width={bw - 2} height={h} fill={color} fill-opacity="0.85" />
    {/each}
  </svg>
{:else}
  <svg viewBox="0 0 {intrinsicW} {height}" preserveAspectRatio="none" class="ui-bars ui-bars--fluid" aria-hidden="true">
    {#each safeData as v, i (i)}
      {@const h = (v / max) * (height - 4)}
      <rect x={i * bw + 1} y={height - h} width={bw - 2} height={h} fill={color} fill-opacity="0.85" />
    {/each}
  </svg>
{/if}

<style>
  .ui-bars {
    display: block;
  }
  .ui-bars--fluid {
    width: 100%;
    height: auto;
  }
</style>

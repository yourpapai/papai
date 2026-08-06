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
  const max = $derived(safeData.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 1))
  const intrinsicW = $derived(width ?? Math.max(safeData.length * 10, 100))
  const bw = $derived(safeData.length > 0 ? intrinsicW / safeData.length : 0)
</script>

{#snippet bars()}
  {#each safeData as v, i (i)}
    {@const h = Math.max(0, (v / max) * (height - 4))}
    <rect x={i * bw + 1} y={height - h} width={bw - 2} height={h} fill={color} fill-opacity="0.85" />
  {/each}
{/snippet}

{#if width !== undefined}
  <svg {width} {height} class="ui-bars" aria-hidden="true">
    {@render bars()}
  </svg>
{:else}
  <!-- `preserveAspectRatio="none"` stretches the bars horizontally to fill the
       panel. Without an explicit pixel height it also stretched them vertically,
       turning the caller's `height` into an aspect-ratio denominator. -->
  <svg
    viewBox="0 0 {intrinsicW} {height}"
    preserveAspectRatio="none"
    class="ui-bars ui-bars--fluid"
    style="height: {height}px"
    aria-hidden="true">
    {@render bars()}
  </svg>
{/if}

<style>
  .ui-bars {
    display: block;
  }
  .ui-bars--fluid {
    width: 100%;
  }
</style>

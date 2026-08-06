<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { hasSeriesData } from '../helpers.js'

  interface Props {
    data: number[]
    /** Omit for a fluid spark that fills its container at `height`. */
    width?: number
    height?: number
    color?: string
    fill?: boolean
  }

  let { data, width, height = 28, color = 'var(--accent)', fill = true }: Props = $props()

  const intrinsicW = $derived(width ?? Math.max(data.length * 10, 100))

  const linePath = $derived.by(() => {
    if (data.length === 0) return ''
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1
    const pts = data.map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * intrinsicW
      const y = height - ((v - min) / range) * (height - 2) - 1
      return `${x},${y}`
    })
    return `M ${pts.join(' L ')}`
  })

  const areaPath = $derived(`${linePath} L ${intrinsicW},${height} L 0,${height} Z`)
</script>

{#snippet paths()}
  {#if fill}
    <path data-role="area" d={areaPath} fill={color} fill-opacity="0.1" />
  {/if}
  <path data-role="line" d={linePath} fill="none" stroke={color} stroke-width="1.25" />
{/snippet}

{#if hasSeriesData(data)}
  {#if width !== undefined}
    <svg {width} {height} class="ui-spark">
      {@render paths()}
    </svg>
  {:else}
    <svg
      viewBox="0 0 {intrinsicW} {height}"
      preserveAspectRatio="none"
      class="ui-spark ui-spark--fluid"
      style="height: {height}px">
      {@render paths()}
    </svg>
  {/if}
{/if}

<style>
  .ui-spark {
    display: block;
  }
  .ui-spark--fluid {
    width: 100%;
  }
</style>

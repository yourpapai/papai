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
    fill?: boolean
  }

  let { data, width = 120, height = 28, color = 'var(--accent)', fill = true }: Props = $props()

  const linePath = $derived.by(() => {
    if (data.length === 0) return ''
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1
    const pts = data.map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width
      const y = height - ((v - min) / range) * (height - 2) - 1
      return `${x},${y}`
    })
    return `M ${pts.join(' L ')}`
  })

  const areaPath = $derived(`${linePath} L ${width},${height} L 0,${height} Z`)
</script>

<svg {width} {height} class="ui-spark">
  {#if fill}
    <path data-role="area" d={areaPath} fill={color} fill-opacity="0.1" />
  {/if}
  <path data-role="line" d={linePath} fill="none" stroke={color} stroke-width="1.25" />
</svg>

<style>
  .ui-spark {
    display: block;
  }
</style>

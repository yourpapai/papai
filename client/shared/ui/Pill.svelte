<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  import Dot from './Dot.svelte'

  type Tone = 'accent' | 'warn' | 'danger' | 'info' | 'neutral' | 'mute'

  interface Props {
    children: Snippet
    tone?: Tone
    dot?: boolean
  }

  let { children, tone = 'neutral', dot = false }: Props = $props()

  const dotColor: Record<Tone, string> = {
    accent: 'var(--accent)',
    warn: 'var(--warn)',
    danger: 'var(--danger)',
    info: 'var(--info)',
    neutral: 'var(--fg3)',
    mute: 'var(--fg4)',
  }
</script>

<span class="ui-pill ui-pill--{tone}">
  {#if dot}
    <Dot color={dotColor[tone]} glow={tone === 'accent'} />
  {/if}
  {@render children()}
</span>

<style>
  .ui-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px;
    line-height: 1.4;
    border: 1px solid transparent;
  }

  .ui-pill--accent {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: rgba(93, 217, 122, 0.3);
  }
  .ui-pill--warn {
    color: var(--warn);
    background: var(--warn-soft);
    border-color: rgba(229, 169, 58, 0.3);
  }
  .ui-pill--danger {
    color: var(--danger);
    background: var(--danger-soft);
    border-color: rgba(232, 92, 92, 0.3);
  }
  .ui-pill--info {
    color: var(--info);
    background: var(--info-soft);
    border-color: rgba(108, 182, 255, 0.3);
  }
  .ui-pill--neutral {
    color: var(--fg2);
    background: transparent;
    border-color: var(--border);
  }
  .ui-pill--mute {
    color: var(--fg3);
    background: transparent;
    border-color: var(--hair);
  }
</style>

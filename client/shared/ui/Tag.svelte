<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  type Tone = 'neutral' | 'required' | 'optional' | 'info'

  interface Props {
    children: Snippet
    tone?: Tone
  }

  let { children, tone = 'neutral' }: Props = $props()
</script>

<span class="ui-tag ui-tag--{tone}">{@render children()}</span>

<style>
  .ui-tag {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 2px;
    line-height: 1.6;
    border: 1px solid var(--hair);
    color: var(--fg3);
  }
  .ui-tag--required {
    color: var(--accent);
    border-color: rgba(93, 217, 122, 0.3);
  }
  .ui-tag--optional {
    color: var(--fg3);
    border-color: var(--hair);
  }
  .ui-tag--info {
    color: var(--info);
    border-color: rgba(108, 182, 255, 0.3);
  }
</style>

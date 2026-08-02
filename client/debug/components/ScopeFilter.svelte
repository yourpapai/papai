<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { ScopeCount } from '../log-bootstrap.js'

  interface Props {
    scopes: ScopeCount[]
    include: string[]
    exclude: string[]
    onChange: (include: string[], exclude: string[]) => void
  }

  let { scopes, include, exclude, onChange }: Props = $props()

  function stateOf(scope: string): 'include' | 'exclude' | 'neutral' {
    if (include.includes(scope)) return 'include'
    if (exclude.includes(scope)) return 'exclude'
    return 'neutral'
  }

  function cycle(scope: string): void {
    const s = stateOf(scope)
    const nextInclude = include.filter((x) => x !== scope)
    const nextExclude = exclude.filter((x) => x !== scope)
    if (s === 'neutral') nextInclude.push(scope)
    else if (s === 'include') nextExclude.push(scope)
    onChange(nextInclude, nextExclude)
  }
</script>

<div class="scope-filter__hint">click to include · again to exclude · again to clear</div>
<div class="scope-filter">
  {#each scopes as { scope, count } (scope)}
    <button
      type="button"
      class="scope-chip scope-chip--{stateOf(scope)}"
      onclick={() => cycle(scope)}
      title={`${scope} (${count})`}>
      {scope}<span class="scope-chip__count">{count}</span>
    </button>
  {/each}
</div>

<style>
  .scope-filter__hint {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
    padding: 0 4px 4px;
  }
  .scope-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 140px;
    overflow-y: auto;
    padding: 4px;
  }
  .scope-chip {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface-1);
    color: var(--text-muted);
    cursor: pointer;
  }
  .scope-chip__count {
    color: var(--text-dim);
    margin-left: 4px;
  }
  .scope-chip--include {
    border-color: var(--accent, #4ea1ff);
    color: var(--text);
  }
  .scope-chip--exclude {
    border-color: var(--danger, #ff5c5c);
    color: var(--text-dim);
    text-decoration: line-through;
  }
</style>

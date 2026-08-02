<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import Panel from '../../shared/ui/Panel.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'
  import type { ToolFailure, DashboardState, ScopeFilter } from '../dashboard-types.js'
  import { panelCount } from '../panel-count.js'

  interface Props {
    dashboard: DashboardState
    onShowFailure: (failure: ToolFailure) => void
  }

  let { dashboard, onShowFailure }: Props = $props()

  function matchesScope(scope: ToolFailure['scope'], filter: ScopeFilter): boolean {
    if (filter === 'all') return true
    if (filter === 'dm') return scope.kind === 'user'
    return scope.kind === 'group'
  }

  function retriableLabel(data: Record<string, unknown>): string {
    if (data['retriable'] === true) return 'retriable'
    if (data['retriable'] === false) return 'non-retriable'
    return ''
  }

  const filtered = $derived(dashboard.toolFailures.filter((f) => matchesScope(f.scope, dashboard.scopeFilter)))

  function failureKey(f: ToolFailure): string {
    return `${f.timestamp}|${String(f.data['toolName'] ?? '')}|${String(f.data['error'] ?? '')}`
  }

  const selectedFailureKey = $derived(
    dashboard.selectedDetail?.kind === 'failure' ? failureKey(dashboard.selectedDetail.payload) : '',
  )
</script>

<Panel title="tool failures" count={panelCount(filtered.length, dashboard.toolFailures.length, dashboard.scopeFilter)}>
  {#snippet body()}
    {#if filtered.length === 0}
      <EmptyState title="No failures" hint="no tool failures in the buffered window" />
    {:else}
      {#each filtered as f, i (i)}
        {@const toolName = typeof f.data['toolName'] === 'string' ? f.data['toolName'] : 'unknown'}
        {@const error = typeof f.data['error'] === 'string' ? f.data['error'] : ''}
        {@const retriable = retriableLabel(f.data)}
        <div
          class="failure-row"
          class:selected={selectedFailureKey === failureKey(f)}
          role="button"
          tabindex="0"
          onclick={() => onShowFailure(f)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onShowFailure(f)
            }
          }}>
          <div class="failure-summary">
            <span class="failure-time">{formatTime(f.timestamp)}</span>
            <span class="failure-tool">{toolName}</span>
            <span class="failure-error">{error}</span>
            {#if retriable !== ''}
              <StatusPill status={retriable} dot={false} />
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  {/snippet}
</Panel>

<style>
  .failure-row {
    border-left: 2px solid var(--danger);
    padding: 6px 8px;
    margin-bottom: 4px;
    cursor: pointer;
    font-size: 11px;
    line-height: 1.4;
  }

  .failure-row:hover {
    background: var(--surface-2);
  }

  .failure-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    color: var(--text-muted);
  }

  .failure-time {
    color: var(--text-dim);
  }

  .failure-tool {
    color: var(--danger);
    font-weight: 600;
  }

  .failure-error {
    color: var(--text);
    word-break: break-word;
  }
</style>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import type { Turn, DashboardState, ScopeFilter } from '../dashboard-types.js'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Pill from '../../shared/ui/Pill.svelte'

  interface Props {
    dashboard: DashboardState
    onShowTurn: (turn: Turn) => void
    onShowLogsForTurn: (turnId: string) => void
  }

  let { dashboard, onShowTurn, onShowLogsForTurn }: Props = $props()

  type ToneType = 'info' | 'danger' | 'warn' | 'accent' | 'neutral' | 'mute'

  function statusTone(status: string): ToneType {
    if (status === 'running') return 'info'
    if (status === 'error') return 'danger'
    if (status === 'cancelled') return 'warn'
    return 'accent'
  }

  function scopeLabel(turn: Turn): string {
    const { kind, userId, groupId, threadId } = turn.scope
    if (kind === 'user') return userId ? `dm:${userId}` : 'dm'
    if (kind === 'group') {
      const base = groupId ? `group:${groupId}` : 'group'
      return threadId ? `${base}/${threadId}` : base
    }
    return 'global'
  }

  function matchesScope(turn: Turn, scope: ScopeFilter): boolean {
    if (scope === 'all') return true
    if (scope === 'dm') return turn.scope.kind === 'user'
    return turn.scope.kind === 'group'
  }

  type TurnRow = {
    id: string
    time: string
    status: string
    scope: string
    durationMs: number
    msgs: number
    toolList: string[]
    _turn: Turn
  }

  const columns = [
    { key: 'time', label: 'Time' },
    { key: 'status', label: 'Status' },
    { key: 'scope', label: 'Scope' },
    { key: 'durationMs', label: 'Duration', align: 'right' as const },
    { key: 'msgs', label: 'Msgs', align: 'right' as const },
    { key: 'toolList', label: 'Tools' },
  ] satisfies { key: string; label: string; align?: 'left' | 'right' | 'center'; width?: string }[]

  const filtered = $derived(dashboard.turns.filter((t) => matchesScope(t, dashboard.scopeFilter)))

  const turnRows = $derived<TurnRow[]>(
    filtered.map((t) => ({
      id: t.turnId,
      time: formatTime(t.startedAt),
      status: t.status,
      scope: scopeLabel(t),
      durationMs: (t.endedAt ?? Date.now()) - t.startedAt,
      msgs: t.incomingMessageCount,
      toolList: t.toolCalls.map((tc) => tc.name),
      _turn: t,
    })),
  )

  const running = $derived(dashboard.turns.filter((t) => t.status === 'running').length)
  const errors = $derived(dashboard.turns.filter((t) => t.status === 'error').length)
  const cancelled = $derived(dashboard.turns.filter((t) => t.status === 'cancelled').length)

  function selectTurn(row: TurnRow): void {
    onShowTurn(row._turn)
  }
</script>

<Panel title="turns" count={dashboard.turns.length}>
  {#snippet action()}
    <div class="turns__summary">
      {#if running > 0}
        <Pill tone="info" dot>running {running}</Pill>
      {/if}
      {#if errors > 0}
        <Pill tone="danger" dot>error {errors}</Pill>
      {/if}
      {#if cancelled > 0}
        <Pill tone="warn" dot>cancelled {cancelled}</Pill>
      {/if}
    </div>
  {/snippet}
  {#snippet body()}
    <DataTable
      {columns}
      rows={turnRows}
      rowKey="id"
      cell={cellRender}
      onRowClick={selectTurn}>
      {#snippet empty()}
        <EmptyState title="No turns" />
      {/snippet}
    </DataTable>
  {/snippet}
</Panel>

{#snippet cellRender(row: TurnRow, col: { key: string; label: string })}
  {#if col.key === 'status'}
    <Pill tone={statusTone(row.status)} dot>{row.status}</Pill>
  {:else if col.key === 'toolList'}
    {#if row.toolList.length === 0}
      <span class="turns__no-tools">—</span>
    {:else}
      <span class="turns__tool-chips">
        {#each row.toolList.slice(0, 3) as toolName (toolName)}
          <Pill tone="neutral">{toolName}</Pill>
        {/each}
        {#if row.toolList.length > 3}
          <span class="turns__overflow">+{row.toolList.length - 3}</span>
        {/if}
      </span>
    {/if}
  {:else if col.key === 'durationMs'}
    {row.durationMs}ms
  {:else if col.key === 'time'}
    {row.time}
  {:else if col.key === 'scope'}
    {row.scope}
  {:else if col.key === 'msgs'}
    {row.msgs}
  {:else}
    {''}
  {/if}
{/snippet}

<style>
  .turns__summary {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .turns__tool-chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    align-items: center;
  }

  .turns__no-tools {
    color: var(--fg4);
    font-size: 11px;
  }

  .turns__overflow {
    font-size: 10px;
    color: var(--fg3);
  }
</style>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fmtNum, formatDateTime } from '../../shared/helpers.js'
  import type { BillingSubject } from '../../shared/api-types.js'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'

  interface Props {
    subjects: readonly BillingSubject[]
    onSelect: (subject: BillingSubject) => void
  }

  let { subjects, onSelect }: Props = $props()

  // Avoid rendering opaque UUIDs: show a typed short label when no display name resolved.
  function displayLabel(subject: BillingSubject): string {
    if (subject.displayName !== null && subject.displayName !== '') return subject.displayName
    const kind = subject.contextType === 'group' ? 'Group' : 'DM'
    return `${kind} · ${subject.storageContextId.slice(0, 8)}`
  }

  interface Row {
    storageContextId: string
    subjectRef: BillingSubject
    subject: string
    type: string
    main: string
    small: string
    embedding: string
    tools: string
    last: string
  }

  const rows = $derived<Row[]>(
    subjects.map((s) => ({
      storageContextId: s.storageContextId,
      subjectRef: s,
      subject: displayLabel(s),
      type: s.contextType,
      main: `${fmtNum(s.totals.main.inputTokens, 0)} / ${fmtNum(s.totals.main.outputTokens, 0)}`,
      small: `${fmtNum(s.totals.small.inputTokens, 0)} / ${fmtNum(s.totals.small.outputTokens, 0)}`,
      embedding: fmtNum(s.totals.embedding.inputTokens, 0),
      tools: fmtNum(s.toolCalls, 0),
      last: formatDateTime(s.lastActiveAt),
    })),
  )

  const tokenTotal = (t: BillingSubject['totals']['main']): number => t.inputTokens + t.outputTokens

  const columns = [
    { key: 'subject' as const, label: 'Subject', width: '1.4fr', sortable: true },
    { key: 'type' as const, label: 'Type', width: '80px', sortable: true },
    {
      key: 'main' as const,
      label: 'Main in/out',
      align: 'right' as const,
      sortable: true,
      sortAccessor: (r: Row) => tokenTotal(r.subjectRef.totals.main),
    },
    {
      key: 'small' as const,
      label: 'Small in/out',
      align: 'right' as const,
      sortable: true,
      sortAccessor: (r: Row) => tokenTotal(r.subjectRef.totals.small),
    },
    {
      key: 'embedding' as const,
      label: 'Embedding in',
      align: 'right' as const,
      sortable: true,
      sortAccessor: (r: Row) => r.subjectRef.totals.embedding.inputTokens,
    },
    {
      key: 'tools' as const,
      label: 'Tools',
      width: '70px',
      align: 'right' as const,
      sortable: true,
      sortAccessor: (r: Row) => r.subjectRef.toolCalls,
    },
    {
      key: 'last' as const,
      label: 'Last active',
      width: '150px',
      align: 'right' as const,
      sortable: true,
      sortAccessor: (r: Row) => r.subjectRef.lastActiveAt,
    },
  ]

  function handleRowClick(row: Row): void {
    onSelect(row.subjectRef)
  }
</script>

<section class="subjects-table">
  <h3>Subjects <span class="count-badge">{subjects.length}</span></h3>
  <DataTable
    {columns}
    {rows}
    rowKey="storageContextId"
    onRowClick={handleRowClick}
    defaultSort={{ key: 'last', dir: 'desc' }}>
    {#snippet cell(row, col)}
      {#if col.key === 'type'}
        <StatusPill status={row.type} dot={false} />
      {:else if col.key === 'subject'}
        <span title={row.storageContextId}>{row.subject}</span>
      {:else}
        {String(row[col.key] ?? '')}
      {/if}
    {/snippet}
    {#snippet empty()}No usage in the selected window{/snippet}
  </DataTable>
</section>

<style>
  .subjects-table {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg3);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .count-badge {
    font-size: 11px;
    font-weight: 500;
    color: var(--fg4);
    background: var(--surface2);
    padding: 1px 6px;
    border-radius: 10px;
  }
</style>

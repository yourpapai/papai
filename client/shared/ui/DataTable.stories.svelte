<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import DataTable from './DataTable.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/DataTable',
    component: DataTable,
  })

  interface Row {
    subject: string
    id: string
    type: 'dm' | 'group'
    tokIn: number
    tokOut: number
  }

  const columns = [
    { key: 'subject', label: 'Subject' },
    { key: 'id', label: 'ID' },
    { key: 'type', label: 'Type' },
    { key: 'tokIn', label: 'Tok in', align: 'right' as const },
    { key: 'tokOut', label: 'Tok out', align: 'right' as const },
  ]

  const rows: Row[] = [
    { subject: 'dl@papai', id: 'u_8f4a92', type: 'dm', tokIn: 412811, tokOut: 84220 },
    { subject: 'priya.r', id: 'u_a02f17', type: 'dm', tokIn: 287402, tokOut: 61104 },
    { subject: 'eng-stand', id: 'g_eng-stand', type: 'group', tokIn: 198220, tokOut: 42811 },
  ]
</script>

<Story name="default">
  <div style="padding: 20px; background: var(--bg); width: 720px;">
    <DataTable {columns} {rows} />
  </div>
</Story>

<Story name="empty">
  {#snippet emptyState()}<span>No data yet.</span>{/snippet}
  <div style="padding: 20px; background: var(--bg); width: 720px;">
    <DataTable {columns} rows={[]} empty={emptyState} />
  </div>
</Story>

<Story name="clickable-with-selection">
  <div style="padding: 20px; background: var(--bg); width: 720px;">
    <DataTable
      {columns}
      {rows}
      rowKey="id"
      selectedKey="u_8f4a92"
      onRowClick={(row) => console.log('clicked', row)} />
  </div>
</Story>

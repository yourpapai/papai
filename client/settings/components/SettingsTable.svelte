<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts" generics="Row extends Record<string, unknown>">
  import type { Snippet } from 'svelte'

  import Btn from '../../shared/ui/Btn.svelte'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Input from '../../shared/ui/Input.svelte'

  type SortDir = 'asc' | 'desc'

  interface Column<R extends Record<string, unknown>> {
    key: keyof R & string
    label: string
    align?: 'left' | 'right' | 'center'
    width?: string
    sortable?: boolean
    sortAccessor?: (row: R) => string | number
  }
  interface Props {
    columns: Column<Row>[]
    rows: Row[]
    rowKey: keyof Row & string
    searchKeys: (keyof Row & string)[]
    cell?: Snippet<[Row, Column<Row>]>
    empty?: Snippet
    pageSize?: number
    searchPlaceholder?: string
    defaultSort?: { key: keyof Row & string; dir: SortDir }
    /** Forwarded to `DataTable` — see its own doc for when this matters. */
    minWidth?: string
  }
  let {
    columns,
    rows,
    rowKey,
    searchKeys,
    cell,
    empty,
    pageSize = 25,
    searchPlaceholder = 'Search…',
    defaultSort,
    minWidth,
  }: Props = $props()

  let query = $state('')
  let page = $state(0)

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return rows
    return rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)))
  })
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)))
  const clampedPage = $derived(Math.min(page, pageCount - 1))
  const pageRows = $derived(filtered.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize))

  function onSearch(v: string): void { query = v; page = 0 }
  function clearSearch(): void { query = ''; page = 0 }

  const noMatches = $derived(rows.length > 0 && filtered.length === 0)
</script>

<div class="settings-table">
  <div class="settings-table__toolbar">
    <Input type="search" value={query} placeholder={searchPlaceholder} onInput={onSearch} testid="settings-table-search" />
    <span class="t-help">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
  </div>
  <div class="settings-table__scroll">
    {#if noMatches}
      <EmptyState title="No matches" icon="⌕" hint={`Nothing matches “${query.trim()}”.`}>
        {#snippet action()}
          <Btn variant="outline" size="sm" onClick={clearSearch} testid="settings-table-clear-search">
            {#snippet children()}Clear search{/snippet}
          </Btn>
        {/snippet}
      </EmptyState>
    {:else}
      <DataTable {columns} rows={pageRows} {cell} {rowKey} {empty} {defaultSort} {minWidth} />
    {/if}
  </div>
  {#if pageCount > 1}
    <div class="settings-table__pager">
      <button type="button" data-testid="settings-table-prev" disabled={clampedPage === 0} onclick={() => (page = clampedPage - 1)}>‹ Prev</button>
      <span class="t-help">Page {clampedPage + 1} / {pageCount}</span>
      <button type="button" data-testid="settings-table-next" disabled={clampedPage >= pageCount - 1} onclick={() => (page = clampedPage + 1)}>Next ›</button>
    </div>
  {/if}
</div>

<style>
  .settings-table { display: flex; flex-direction: column; gap: 10px; }
  .settings-table__toolbar { display: flex; align-items: center; gap: 12px; }
  .settings-table__toolbar :global(.ui-input) { flex: 1; max-width: 320px; }
  .settings-table__scroll { max-height: 560px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); }
  .settings-table__scroll :global(thead th) {
    position: sticky; top: 0; z-index: 1;
    background: var(--surface-2);
  }
  .settings-table__scroll :global(tbody tr:hover) { background: var(--surface-hover); }
  .settings-table__pager { display: flex; align-items: center; gap: 12px; }
  .settings-table__pager button {
    background: transparent; border: 1px solid var(--border); border-radius: var(--radius);
    color: var(--text); font-family: var(--font-mono); font-size: 12px; padding: 4px 10px; cursor: pointer;
  }
  .settings-table__pager button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>

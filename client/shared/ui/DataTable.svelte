<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts" generics="Row extends Record<string, unknown>">
  import type { Snippet } from 'svelte'

  type Align = 'left' | 'right' | 'center'
  type SortDir = 'asc' | 'desc'

  interface Column<R extends Record<string, unknown>> {
    key: keyof R & string
    label: string
    align?: Align
    width?: string
    /** Enable click-to-sort on this column's header. */
    sortable?: boolean
    /** Value to sort by (defaults to `row[key]`); use for columns whose cell text is formatted. */
    sortAccessor?: (row: R) => string | number
  }

  interface Props {
    columns: Column<Row>[]
    rows: Row[]
    cell?: Snippet<[Row, Column<Row>]>
    onRowClick?: (row: Row) => void
    selectedKey?: string
    rowKey?: keyof Row & string
    empty?: Snippet
    /** Initial sort applied on mount (column must be sortable). */
    defaultSort?: { key: keyof Row & string; dir: SortDir }
  }

  let { columns, rows, cell, onRowClick, selectedKey, rowKey, empty, defaultSort }: Props = $props()

  let sortKey = $state<string | null>(defaultSort?.key ?? null)
  let sortDir = $state<SortDir>(defaultSort?.dir ?? 'asc')

  function sortValue(row: Row, col: Column<Row>): string | number {
    if (col.sortAccessor !== undefined) return col.sortAccessor(row)
    const raw = row[col.key]
    if (typeof raw === 'number') return raw
    return String(raw ?? '')
  }

  const sortedRows = $derived.by<Row[]>(() => {
    if (sortKey === null) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (col === undefined) return rows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = sortValue(a, col)
      const bv = sortValue(b, col)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  })

  function toggleSort(col: Column<Row>): void {
    if (col.sortable !== true) return
    if (sortKey === col.key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc'
    } else {
      sortKey = col.key
      sortDir = 'asc'
    }
  }

  function sortIndicator(col: Column<Row>): string {
    if (sortKey !== col.key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  function clickRow(row: Row): (event: MouseEvent) => void {
    return (event: MouseEvent) => {
      // Only fire row-click when click target is a td (not a child link/button).
      const target = event.target
      if (target instanceof HTMLElement && target.closest('a, button')) return
      onRowClick?.(row)
    }
  }
</script>

<table class="ui-datatable">
  <thead>
    <tr>
      {#each columns as col (col.key)}
        <th
          class="ui-datatable__th ui-datatable__th--{col.align ?? 'left'}"
          aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : null}
          style:width={col.width ?? null}>
          {#if col.sortable === true}
            <button type="button" class="ui-datatable__sort" onclick={() => toggleSort(col)}>
              {col.label}{sortIndicator(col)}
            </button>
          {:else}
            {col.label}
          {/if}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#if rows.length === 0}
      {#if empty}
        <tr>
          <td colspan={columns.length} class="ui-datatable__empty">
            {@render empty()}
          </td>
        </tr>
      {/if}
    {:else}
      {#each sortedRows as row, i (rowKey ? row[rowKey] : i)}
        {@const key = rowKey ? String(row[rowKey]) : String(i)}
        <tr
          class="ui-datatable__tr"
          class:ui-datatable__tr--selected={selectedKey !== undefined && selectedKey === key}
          class:ui-datatable__tr--clickable={onRowClick !== undefined}
          onclick={onRowClick ? clickRow(row) : null}>
          {#each columns as col (col.key)}
            <td class="ui-datatable__td ui-datatable__td--{col.align ?? 'left'}">
              {#if cell}
                {@render cell(row, col)}
              {:else}
                {String(row[col.key] ?? '')}
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    {/if}
  </tbody>
</table>

<style>
  .ui-datatable {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
  }
  .ui-datatable__th {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg3);
    padding: 8px 12px;
    border-bottom: 1px solid var(--hair);
    text-align: left;
  }
  .ui-datatable__sort {
    all: unset;
    cursor: pointer;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    white-space: nowrap;
  }
  .ui-datatable__sort:hover {
    color: var(--fg);
  }
  .ui-datatable__th--right .ui-datatable__sort {
    text-align: right;
  }
  .ui-datatable__th--right {
    text-align: right;
  }
  .ui-datatable__th--center {
    text-align: center;
  }
  .ui-datatable__td {
    font-size: 13px;
    color: var(--fg);
    padding: 10px 12px;
    border-bottom: 1px solid var(--hair);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ui-datatable__td--right {
    text-align: right;
  }
  .ui-datatable__td--center {
    text-align: center;
  }
  .ui-datatable__tr--clickable {
    cursor: pointer;
  }
  .ui-datatable__tr--clickable:hover {
    background: rgba(255, 255, 255, 0.02);
  }
  .ui-datatable__tr--selected {
    background: rgba(93, 217, 122, 0.06);
  }
  .ui-datatable__empty {
    padding: 24px 12px;
    text-align: center;
    color: var(--fg3);
    font-size: 12px;
  }
</style>

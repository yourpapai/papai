<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts" generics="Row extends Record<string, unknown>">
  import type { Snippet } from 'svelte'

  type Align = 'left' | 'right' | 'center'

  interface Column<R extends Record<string, unknown>> {
    key: keyof R & string
    label: string
    align?: Align
    width?: string
  }

  interface Props {
    columns: Column<Row>[]
    rows: Row[]
    cell?: Snippet<[Row, Column<Row>]>
    onRowClick?: (row: Row) => void
    selectedKey?: string
    rowKey?: keyof Row & string
    empty?: Snippet
  }

  let { columns, rows, cell, onRowClick, selectedKey, rowKey, empty }: Props = $props()

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
          style:width={col.width ?? null}>{col.label}</th>
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
      {#each rows as row, i (rowKey ? row[rowKey] : i)}
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

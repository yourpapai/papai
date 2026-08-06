<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  export interface SidebarItem {
    id: string
    label: string
  }
  export interface SidebarGroup {
    kicker: string
    /** Stable identity for collapse state; falls back to the kicker when absent. */
    key?: string
    items: readonly SidebarItem[]
    danger?: boolean
    collapsible?: boolean
    collapsed?: boolean
  }

  interface Props {
    groups: readonly SidebarGroup[]
    activeId: string
    onToggle?: (groupKey: string) => void
  }

  let { groups, activeId, onToggle }: Props = $props()
</script>

<aside class="settings-sidebar">
  {#each groups as group (group.key ?? group.kicker)}
    <div class="settings-sidebar__group" class:settings-sidebar__group--danger={group.danger === true}>
      {#if group.collapsible === true}
        <button
          type="button"
          class="t-kicker settings-sidebar__kicker settings-sidebar__kicker--toggle"
          aria-expanded={group.collapsed !== true}
          data-testid={`sidebar-toggle-${group.kicker}`}
          onclick={() => onToggle?.(group.key ?? group.kicker)}>
          <span class="settings-sidebar__chevron">{group.collapsed === true ? '▸' : '▾'}</span>
          {group.kicker}
        </button>
      {:else}
        <div class="t-kicker settings-sidebar__kicker">
          {group.kicker}{#if group.danger}<span class="settings-sidebar__badge">admin</span>{/if}
        </div>
      {/if}
      {#if group.collapsed !== true}
        <nav class="settings-sidebar__nav">
          {#each group.items as item (item.id)}
            <a
              class="settings-sidebar__link"
              class:settings-sidebar__link--active={activeId === item.id}
              aria-current={activeId === item.id ? 'page' : undefined}
              href={`#${item.id}`}>
              {item.label}
            </a>
          {/each}
        </nav>
      {/if}
    </div>
  {/each}
</aside>

<style>
  .settings-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    padding: var(--s4) var(--s3);
    background: var(--surface-1);
    border-right: 1px solid var(--border);
    /* Fills its grid track and scrolls inside it. No sticky/100vh box: that box was
       taller than the scrollport it sat in, and being sticky, the outer scroll could
       never bring its tail into view. */
    height: 100%;
    overflow-y: auto;
  }
  .settings-sidebar__group--danger {
    border-left: 2px solid var(--danger);
    padding-left: var(--s3);
    margin-left: calc(-1 * var(--s3));
  }
  .settings-sidebar__kicker {
    display: flex;
    align-items: center;
    gap: var(--s2);
    margin-bottom: var(--s2);
  }
  .settings-sidebar__kicker--toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    text-align: left;
    width: 100%;
    font: inherit;
  }
  .settings-sidebar__chevron {
    margin-right: 2px;
  }
  .settings-sidebar__badge {
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: var(--radius-pill);
    padding: 0 var(--s2);
    font-size: 9px;
    letter-spacing: 0.08em;
  }
  /* 2px is below the 4px scale on purpose: at --s1 (4px) a 16-item admin nav grows by
     14px, which is what pushes its tail out of a short viewport. */
  .settings-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .settings-sidebar__link {
    color: var(--text-muted);
    text-decoration: none;
    padding: var(--s2);
    font-family: var(--font-mono);
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .settings-sidebar__link:hover {
    color: var(--text);
    background: var(--surface-hover);
  }
  .settings-sidebar__link--active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--surface-2);
  }
  @media (max-width: 900px) {
    .settings-sidebar {
      display: none;
    }
  }
</style>

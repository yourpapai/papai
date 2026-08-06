<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Caption from '../../shared/ui/Caption.svelte'
  import HR from '../../shared/ui/HR.svelte'
  import KV from '../../shared/ui/KV.svelte'

  import { adminSections } from '../admin.svelte.js'
  import { adminGlobals } from '../global-stats.svelte.js'

  const items = adminSections

  interface Props {
    activeId: string
  }

  let { activeId }: Props = $props()
</script>

<aside class="admin-sidebar">
  <Caption>{#snippet children()}sections{/snippet}</Caption>
  <nav class="admin-sidebar__nav">
    {#each items as item (item.id)}
      <a
        class="admin-sidebar__link"
        class:admin-sidebar__link--active={activeId === item.id}
        href={`#${item.id}`}>
        {item.label}
      </a>
    {/each}
  </nav>
  <HR />
  <Caption>{#snippet children()}quick stats{/snippet}</Caption>
  <div class="admin-sidebar__kvs">
    <KV k="DM" v={adminGlobals.data?.subjects?.dmTotal ?? '—'} />
    <KV k="active" v={adminGlobals.data?.active?.activeIn30d ?? '—'} />
    <KV k="tools" v="—" />
  </div>
</aside>

<style>
  .admin-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    background: var(--surface-1);
    border-right: 1px solid var(--border);
    min-height: 100vh;
  }
  /* 2px is below the 4px scale on purpose: this is a hairline marker, not spacing. */
  .admin-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .admin-sidebar__link {
    color: var(--text-muted);
    text-decoration: none;
    padding: var(--s2);
    font-family: var(--font-mono);
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .admin-sidebar__link:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .admin-sidebar__link--active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--surface-2);
  }
  .admin-sidebar__kvs {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }
</style>

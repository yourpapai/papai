<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Select from '../../shared/ui/Select.svelte'

  import type { SidebarGroup } from './SettingsSidebar.svelte'

  interface Props {
    groups: readonly SidebarGroup[]
    activeId: string
  }

  let { groups, activeId }: Props = $props()

  // A collapsed group's sections are not mounted, so offering them here would
  // navigate to a fragment that does not exist on the page.
  const options = $derived(
    groups
      .filter((group) => group.collapsed !== true)
      .map((group) => ({
        label: group.kicker,
        options: group.items.map((item) => ({ value: item.id, label: item.label })),
      })),
  )

  function onChange(id: string): void {
    window.location.hash = `#${id}`
  }
</script>

<div class="settings-jump">
  <span class="t-label" id="settings-jump-label">Jump to</span>
  <Select value={activeId} groups={options} {onChange} block testid="settings-jump-select" />
</div>

<style>
  .settings-jump {
    display: none;
    flex-direction: column;
    gap: var(--gap-tight);
    padding: var(--gap-inline) var(--gap-section) 0;
  }
  @media (max-width: 900px) {
    .settings-jump {
      display: flex;
    }
  }
</style>

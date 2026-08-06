<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Select from '../../shared/ui/Select.svelte'

  import { adminSections } from '../admin.svelte.js'

  interface Props {
    activeId: string
  }

  let { activeId }: Props = $props()

  // Admin's six sections are ungrouped, so this is a flat `options` list rather than the
  // `groups` the settings jump menu builds from its collapsible sidebar groups.
  const options = adminSections.map((section) => ({ value: section.id, label: section.label }))

  function onChange(id: string): void {
    window.location.hash = `#${id}`
  }
</script>

<div class="admin-jump">
  <span class="admin-jump__lbl" id="admin-jump-label">Jump to</span>
  <!-- This menu is not wrapped in a Field, so the shared Select never picks up a label id
       from Field context; pass this span's id explicitly so the select still gets an
       accessible name. -->
  <Select
    value={activeId}
    {options}
    {onChange}
    block
    testid="admin-jump-select"
    ariaLabelledby="admin-jump-label" />
</div>

<style>
  .admin-jump {
    display: none;
    flex-direction: column;
    gap: var(--s1);
    width: 100%;
  }
  /* Repeats AdminTopBar's `.admin-topbar__lbl` because Svelte scoping keeps that class
     inside its own component, and the settings-only type-scale utility (settings.css:92)
     is not loaded by admin.html. This is the concrete cost of the deferred
     `settings-app-no-shared-type-scale` finding. */
  .admin-jump__lbl {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  @media (max-width: 900px) {
    .admin-jump {
      display: flex;
    }
  }
</style>

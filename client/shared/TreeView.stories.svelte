<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import TreeView from './TreeView.svelte'

  const { Story } = defineMeta({
    title: 'shared/TreeView',
    component: TreeView,
  })
</script>

<Story name="Nested object">
  <div style="padding: 20px; background: var(--bg); min-height: 200px;">
    <TreeView label="payload" value={{ id: 1, ok: true, items: [{ k: 'a' }, { k: 'b' }], note: null }} />
  </div>
</Story>

<Story name="Array">
  <div style="padding: 20px; background: var(--bg); min-height: 200px;">
    <TreeView label="rows" value={[1, 2, 3, 'four']} />
  </div>
</Story>

<Story name="Primitive">
  <div style="padding: 20px; background: var(--bg); min-height: 200px;">
    <TreeView label="count" value={42} />
  </div>
</Story>

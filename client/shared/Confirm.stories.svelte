<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Confirm from './Confirm.svelte'

  const { Story } = defineMeta({
    title: 'shared/Confirm',
    component: Confirm,
  })

  const noop = () => undefined
</script>

<Story name="Default" asChild>
  <Confirm
    open
    title="Delete project?"
    onCancel={noop}
    onConfirm={noop}
    cancelLabel={undefined}
    confirmLabel={undefined}>
    {#snippet body()}
      <p>This permanently removes the project and its tasks.</p>
    {/snippet}
  </Confirm>
</Story>

<Story name="Custom labels" asChild>
  <Confirm open title="Discard changes?" onCancel={noop} onConfirm={noop} cancelLabel="Keep editing" confirmLabel="Discard">
    {#snippet body()}
      <p>Your unsaved edits will be lost.</p>
    {/snippet}
  </Confirm>
</Story>

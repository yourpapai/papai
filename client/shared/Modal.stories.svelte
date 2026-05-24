<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Modal from './Modal.svelte'

  const { Story } = defineMeta({
    title: 'shared/Modal',
    component: Modal,
  })

  const noop = () => undefined
</script>

<Story name="Default" asChild>
  <Modal open title="Subject details" onClose={noop} size={undefined} footer={undefined}>
    {#snippet body()}
      <p>modal body content</p>
    {/snippet}
  </Modal>
</Story>

<Story name="With footer" asChild>
  <Modal open title="Confirm change" onClose={noop} size="sm">
    {#snippet body()}
      <p>Are you sure?</p>
    {/snippet}
    {#snippet footer()}
      <button type="button">Save</button>
    {/snippet}
  </Modal>
</Story>

<Story name="Large" asChild>
  <Modal open title="Raw event" onClose={noop} size="xl" footer={undefined}>
    {#snippet body()}
      <pre>{'{ "event": "llm:full", "tokens": 1234 }'}</pre>
    {/snippet}
  </Modal>
</Story>

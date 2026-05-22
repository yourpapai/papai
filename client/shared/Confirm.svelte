<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  import Modal from './Modal.svelte'

  interface Props {
    open: boolean
    title: string
    onCancel: () => void
    onConfirm: () => void
    body: Snippet
    cancelLabel: string | undefined
    confirmLabel: string | undefined
  }

  let { open, title, onCancel, onConfirm, body, cancelLabel, confirmLabel }: Props = $props()

  const resolvedCancelLabel = $derived(cancelLabel === undefined ? 'Cancel' : cancelLabel)
  const resolvedConfirmLabel = $derived(confirmLabel === undefined ? 'Confirm' : confirmLabel)
</script>

<Modal {open} {title} onClose={onCancel} {body} size="sm">
  {#snippet footer()}
    <button type="button" onclick={onCancel}>{resolvedCancelLabel}</button>
    <button type="button" onclick={onConfirm}>{resolvedConfirmLabel}</button>
  {/snippet}
</Modal>

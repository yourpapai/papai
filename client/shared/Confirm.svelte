<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'
  import Btn from './ui/Btn.svelte'
  import Modal from './Modal.svelte'

  interface Props {
    open: boolean
    title: string
    onCancel: () => void
    onConfirm: () => void
    body: Snippet
    cancelLabel?: string
    confirmLabel?: string
    danger?: boolean
    busy?: boolean
  }
  let { open, title, onCancel, onConfirm, body, cancelLabel, confirmLabel, danger = false, busy = false }: Props =
    $props()
  const resolvedCancelLabel = $derived(cancelLabel ?? 'Cancel')
  const resolvedConfirmLabel = $derived(confirmLabel ?? 'Confirm')
</script>

<Modal {open} {title} onClose={busy ? () => {} : onCancel} {body} size="sm">
  {#snippet footer()}
    <Btn variant="secondary" disabled={busy} onClick={onCancel}>
      {#snippet children()}{resolvedCancelLabel}{/snippet}
    </Btn>
    <Btn variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
      {#snippet children()}{busy ? 'Working…' : resolvedConfirmLabel}{/snippet}
    </Btn>
  {/snippet}
</Modal>

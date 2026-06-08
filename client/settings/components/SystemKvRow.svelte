<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import { maskSecret } from '../lib/mask-secret.js'

  interface Props {
    keyName: string
    value: string | null
    sensitive: boolean
    onSave: (value: string) => void
  }
  let { keyName, value, sensitive, onSave }: Props = $props()

  let editing = $state(false)
  let draft = $state('')

  const display = $derived(value === null ? null : sensitive ? maskSecret(value) : value)

  function start(): void { editing = true; draft = '' }
  function cancel(): void { editing = false; draft = '' }
  function save(): void {
    if (draft.trim() === '') return
    onSave(draft)
    editing = false
    draft = ''
  }
</script>

<tr class="kv-row" data-testid={`system-row-${keyName}`}>
  <td class="kv-row__key t-mono-data">{keyName}</td>
  <td class="kv-row__val">
    {#if editing}
      <Input
        type={sensitive ? 'password' : 'text'}
        value={draft}
        placeholder="enter a new value"
        onInput={(v) => (draft = v)}
        testid={`system-input-${keyName}`} />
    {:else if display === null}
      <span class="placeholder">unset</span>
    {:else}
      <span class="t-mono-data">{display}</span>
    {/if}
  </td>
  <td class="kv-row__action">
    {#if editing}
      <Btn variant="primary" size="sm" testid={`system-save-${keyName}`} onClick={save}>
        {#snippet children()}Save{/snippet}
      </Btn>
      <Btn variant="secondary" size="sm" testid={`system-cancel-${keyName}`} onClick={cancel}>
        {#snippet children()}Cancel{/snippet}
      </Btn>
    {:else}
      <Btn variant="secondary" size="sm" testid={`system-edit-${keyName}`} onClick={start}>
        {#snippet children()}Edit{/snippet}
      </Btn>
    {/if}
  </td>
</tr>

<style>
  .kv-row__key { color: var(--text-muted); padding: 8px 12px; white-space: nowrap; vertical-align: middle; }
  .kv-row__val { padding: 8px 12px; vertical-align: middle; }
  .kv-row__action { padding: 8px 12px; text-align: right; white-space: nowrap; display: flex; gap: 6px; justify-content: flex-end; }
  .kv-row { border-bottom: 1px solid var(--border); }
</style>

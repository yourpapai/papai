<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'

  interface Props {
    models: string[]
    onSave: (models: string[]) => Promise<boolean>
    onCancel: () => void
    busy?: boolean
    testid?: string
  }

  let { models, onSave, onCancel, busy = false, testid = 'models-editor' }: Props = $props()

  let draft = $state(models.join('\n'))

  async function save(): Promise<void> {
    if (busy) return
    const parsed = draft.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    await onSave(parsed)
  }
</script>

<div class="models-editor" data-testid={testid}>
  <textarea
    bind:value={draft}
    rows="5"
    placeholder="Enter model names, one per line"
    data-testid={`${testid}-textarea`}
    class="models-editor__textarea"></textarea>
  <div class="models-editor__actions">
    <Btn variant="primary" size="sm" disabled={busy} onClick={() => void save()} testid={`${testid}-save`}>
      {#snippet children()}{busy ? 'Saving…' : 'Save models'}{/snippet}
    </Btn>
    <Btn variant="ghost" size="sm" onClick={onCancel} testid={`${testid}-cancel`}>
      {#snippet children()}Cancel{/snippet}
    </Btn>
  </div>
</div>

<style>
  .models-editor {
    display: grid;
    gap: 8px;
    padding: 12px 0;
  }
  .models-editor__textarea {
    width: 100%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 8px;
    resize: vertical;
  }
  .models-editor__actions {
    display: flex;
    gap: 8px;
  }
</style>

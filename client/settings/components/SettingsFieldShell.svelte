<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  // Per-instance sequence for a stable label id, mirroring Field.svelte.
  let seq = 0
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'

  import { setFieldError, setFieldLabelId } from '../../shared/ui/field-context.js'
  import LiveRegion from '../../shared/ui/LiveRegion.svelte'

  interface Props {
    label: string
    required?: boolean
    testid?: string
    // Whether to render the editor slot. Consumers pass their own open/closed logic
    // (masked-resting secret fields render `head` only). Defaults to true.
    editorOpen?: boolean
    // Inline validation message for this field; suppresses `hint` while set.
    error?: string
    hint?: string
    head?: Snippet<[string | undefined]>
    editor?: Snippet<[string]>
    footer?: Snippet
  }

  let { label, required = false, testid, editorOpen = true, error, hint, head, editor, footer }: Props = $props()

  // Publish the label element id so an Input rendered in the `editor` snippet gets an
  // accessible name (aria-labelledby) — restoring what the old Field wrapper provided,
  // now pointing at the real field name instead of a generic "Value"/"New value".
  const uid = ++seq
  const labelId = `settings-field-${uid}`
  const errorId = `settings-field-err-${uid}`
  const hintId = `settings-field-hint-${uid}`
  setFieldLabelId(labelId)
  // Getter, not a snapshot: this is what makes the descendant control track the live
  // `error` prop rather than its value at init.
  setFieldError({
    errorId,
    hintId,
    get invalid() {
      return error !== undefined && error !== ''
    },
    get hasHint() {
      return hint !== undefined && hint !== ''
    },
    get required() {
      return required
    },
  })
</script>

<div class="settings-field" data-testid={testid}>
  <div class="settings-field__head">
    <span class="settings-field__label" id={labelId}>{label}{#if required}<span class="settings-field__req" aria-hidden="true">*</span>{/if}</span>
    <!-- Mirrors the `editor(labelId)` pattern above: a `head`-rendered control (e.g. a
         SegmentedControl) can't reach the field-error context set below, since Svelte
         context published here isn't visible in the parent's snippet scope. Pass the
         error id explicitly instead, and only when the error `<p>` below actually
         renders — otherwise the control would get an aria-describedby pointing at
         nothing. When no error is showing, hand down the hint id instead, so a head
         control is described by the field's own status line rather than by nothing. -->
    {@render head?.(error ? errorId : hint ? hintId : undefined)}
  </div>
  {#if editor && editorOpen}
    <div class="settings-field__editor">{@render editor(labelId)}</div>
  {/if}
  <div class="settings-field__msg">
    <LiveRegion tone="alert" message={error ?? null} id={errorId} class="settings-field__error" />
    {#if !error && hint}<p class="settings-field__hint" id={hintId}>{hint}</p>{/if}
  </div>
  {@render footer?.()}
</div>

<style>
  .settings-field {
    display: grid;
    gap: var(--gap-tight);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-1);
  }
  .settings-field__head {
    display: flex;
    align-items: center;
    gap: var(--gap-tight);
    flex-wrap: wrap;
  }
  .settings-field__label {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    margin-right: auto;
  }
  .settings-field__req {
    color: var(--accent);
    margin-left: 5px;
  }
  .settings-field__editor {
    display: flex;
    align-items: end;
    gap: var(--gap-tight);
    flex-wrap: wrap;
  }
  .settings-field__editor :global(.ui-input) {
    flex: 1;
    min-width: 200px;
  }
  /* :global because the class is handed to LiveRegion, and a class passed to a child
     component does not pick up this component's scoped styles. Scoped to the message box
     so it stays a SettingsFieldShell rule rather than an app-wide one. */
  .settings-field__msg :global(.settings-field__error) {
    margin: 0;
    color: var(--danger);
    font-size: 12px;
  }
  .settings-field__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  /* The region stays mounted so a screen reader can hear it change, which means it is
     still a grid child when it holds no text -- and a zero-height grid child consumes a
     full row gap. It cannot be display:none'd or visibility:hidden'd without leaving the
     accessibility tree, so cancel the gap instead of removing the box. */
  .settings-field__msg:not(:has(*:not(:empty))) {
    margin-top: calc(-1 * var(--gap-tight));
  }
</style>

<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  let seq = 0
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'

  import { setFieldError, setFieldLabelId } from './field-context.js'
  import LiveRegion from './LiveRegion.svelte'

  interface Props {
    label: string
    children: Snippet
    required?: boolean
    hint?: string
    error?: string
  }

  let { label, children, required = false, hint, error }: Props = $props()

  const uid = ++seq
  const labelId = `ui-field-${uid}`
  const errorId = `ui-field-err-${uid}`
  const hintId = `ui-field-hint-${uid}`
  setFieldLabelId(labelId)
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

<div class="ui-field">
  <span class="ui-field__label" id={labelId}>
    {label}{#if required}<span class="ui-field__req" aria-hidden="true">*</span>{/if}
  </span>
  <div class="ui-field__control">{@render children()}</div>
  <div class="ui-field__msg">
    <LiveRegion tone="alert" message={error ?? null} id={errorId} class="ui-field__error" />
    {#if !error && hint}<span class="ui-field__hint" id={hintId}>{hint}</span>{/if}
  </div>
</div>

<style>
  /* subgrid adopts the parent's three tracks so this field's label, control and
     hint align with every sibling's. Outside a grid parent, subgrid is invalid
     and falls back to independent auto rows -- visually the same stack as the
     column flex this replaces. */
  .ui-field {
    display: grid;
    grid-template-rows: subgrid;
    grid-row: span 3;
    gap: 6px;
    min-width: 0;
  }
  /* A real box now, so the control always occupies exactly one grid row no
     matter how many elements the children slot emits. */
  .ui-field__control {
    display: block;
    min-width: 0;
  }
  .ui-field__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .ui-field__req {
    color: var(--accent);
    margin-left: 5px;
  }
  .ui-field__hint {
    font-size: 10px;
    color: var(--text-dim);
  }
  /* :global because the class is handed to LiveRegion, and a class passed to a child
     component does not pick up this component's scoped styles. Scoped to the message box
     so it stays a Field rule rather than an app-wide one. */
  .ui-field__msg :global(.ui-field__error) {
    font-size: 10px;
    color: var(--danger);
  }
  /* The region stays mounted so a screen reader can hear it change, which means it is
     still a grid child when it holds no text -- and a zero-height grid child consumes a
     full row gap. It cannot be display:none'd or visibility:hidden'd without leaving the
     accessibility tree, so cancel the gap instead of removing the box. */
  .ui-field__msg:not(:has(*:not(:empty))) {
    margin-top: -6px;
  }
</style>

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
  {#if error}<span class="ui-field__error" id={errorId} role="alert">{error}</span>{:else if hint}<span
      class="ui-field__hint" id={hintId}>{hint}</span>{/if}
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
  .ui-field__error {
    font-size: 10px;
    color: var(--danger);
  }
</style>

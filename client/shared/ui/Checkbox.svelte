<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    checked: boolean
    label: string
    onChange: (checked: boolean) => void
    disabled?: boolean
    testid?: string
  }

  let { checked, label, onChange, disabled = false, testid }: Props = $props()

  function handleChange(event: Event): void {
    onChange((event.target as HTMLInputElement).checked)
  }
</script>

<label class="ui-checkbox" class:ui-checkbox--disabled={disabled}>
  <span class="ui-checkbox__label">{label}</span>
  <input type="checkbox" {checked} {disabled} data-testid={testid} onchange={handleChange} />
</label>

<style>
  .ui-checkbox {
    display: inline-flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
  }
  .ui-checkbox--disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .ui-checkbox__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .ui-checkbox input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--accent);
    cursor: inherit;
  }
  .ui-checkbox input:focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
</style>

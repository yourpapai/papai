<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shared primitives + TaskProviderSection close-out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three open UX findings — two anchored in shared UI primitives (`Secret`, `SegmentedControl`) and one at the `TaskProviderSection` call site — taking `TaskProviderSection` to `0 open` and dropping the backlog from 26 open to 23.

**Architecture:** Shared primitives change first, because a primitive change moves many sections' screenshot baselines at once and would invalidate any section work already verified. `Secret` gains a one-branch empty-string guard falling back to its own existing `'••••••••'` default; `SegmentedControl` gains an optional `busy` prop that renders a `Saving…` caption and `aria-busy`, defaulting to off so existing consumers are untouched. Only then does the section-local `TaskProviderSection` inset fix land, followed by the documentation close-out and the unfiltered gates.

**Tech Stack:** Svelte 5 runes (`$props`, `$state`), strict TypeScript with `noUncheckedIndexedAccess`, Bun test runner (`bun:test`) with `mount`/`flushSync`/`unmount`, Storybook + `@crvy/strybk` Playwright visual specs, MSW fixtures, `oxfmt` formatter, `oxlint`.

**Spec:** `docs/superpowers/specs/2026-08-04-shared-primitives-and-task-provider-design.md`

## Global Constraints

These bind every task. Copied from the spec; treat them as part of each task's requirements.

- **Branch:** all work stays on `ui-ux-review-01` in this worktree. **No merge into `master`. No push.** PR #212 is already open; do not touch it.
- **Never use `--no-verify`.** The pre-commit hook runs lint / typecheck / format:check / license-headers. If it fails, fix the cause.
- **Never add a lint-disable or type-ignore comment.** Hook policy blocks them; fix the underlying issue.
- **A `max-lines` / `max-lines-per-function` failure is a design signal.** Split the file or extract a function; do not delete blank lines or compress formatting to squeak under the limit. `client/stories/msw/settings-handlers.ts` has an enforced 300-line max.
- **`client/shared/ui/SummaryList.svelte` MUST NOT be modified.** It has six consumers; five (`TraceDetail`, `LogDetail`, `FailureDetail`, `TurnDetail`, `SessionDetail`) render inside `DebugDetailRail`, which already supplies `padding: 16px` (`DebugDetailRail.svelte:81`). Padding the primitive would double-pad five correct consumers to fix one broken one. The fix lands at the `TaskProviderSection` call site.
- **Do not introduce a new placeholder glyph.** `Secret.svelte` already declares `value = '••••••••'`. Reuse it. A second variant would make two `Secret` renderings disagree about what a stored secret looks like.
- **`client/settings/lib/mask-secret.ts` MUST NOT be modified.** It stays a pure string normalizer; the guard belongs in `Secret.svelte` so all six `Secret` consumers inherit it.
- **The inset acceptance criterion is alignment, not a pixel count.** In the re-shot `TaskProvider-—-provision-reveal-1.png`, the `SummaryList` values' right edge must line up with the sibling `Clear` button's right edge. Use `var(--gap-inline)`. **Hand-tuned one-off px values are forbidden** — matching the token scale is the point of the finding.
- **Do not edit any pre-existing test to make it pass. Escalate instead.** In the predecessor project the list of tests-that-may-change was wrong four separate times, and every implementer who escalated instead of editing was correct to.
- **Never put real or realistic-looking credentials in a fixture.** Repo pattern: `example.invalid`, `example-password-not-real`.
- **A green visual audit proves nothing after a re-shoot** — `bun shoot` passes `--update-snapshots=all`, so the audit passes by construction. **Every changed PNG must be read with the Read tool and described.** `.storybook-shots/` is git-ignored; find changed PNGs with `find`/timestamps, never `git status`.
- **`bun run visual:audit` must be run unfiltered.** `-g <Section>` is diagnosis only, never a gate.
- **Expected audit count: 466 → 467.** Exactly one new baseline is added across the whole project.
- **Expected backlog: 26 open → 23 open.** The `debug-icon-buttons-control-height` → `superseded` recommendation is **NOT approved** — it stays `open`. Do not change its status.
- **Statuses are exactly `open` / `fixed` / `superseded`.** There is no `partial`. A partially-fixed finding stays `open` with its text narrowed to the residue. A non-`open` status **requires** a `- **Resolved:**` line citing a real commit hash or the backlog parser fails loud.
- **`docs/ux-reviews/_BACKLOG.md` is generated — never hand-edit it.** Regenerate with `bun run ux:backlog`.
- **Report whatever the generator actually produces.** A count reached by declaring a residual defect fixed is a failure however green the audit is.
- **Client tests are excluded from default discovery.** `bunfig.toml:8` sets `pathIgnorePatterns = ["tests/e2e/**", "tests/client/**", "tests/visual/**", "tests/stories/**"]`, so `bun test tests/client/...` silently discovers nothing. Run client tests with `bun run test:client`, which supplies `--conditions=browser`, the `tests/client-setup.ts` preload, and `--path-ignore-patterns ''`. Narrow to one case with `bun run test:client -t '<test name substring>'`. To scope to a single file, run the underlying command with that path substituted for `tests/client/`.
- **Baseline PNG filenames are not the story name alone.** `snapshotPathTemplate` is `.storybook-shots/{testFilePath}/{arg}{ext}`, and `{arg}` is the **full** Playwright title path. A generated case inside `test.describe('settings/sections/TaskProviderSection')` writes `settings-sections-TaskProviderSection-Bound-1.png`; a manual top-level `test('TaskProvider — provision reveal')` writes `TaskProvider-—-provision-reveal-1.png`. If a path in a task step does not exist, `ls` the directory rather than assuming the shot was not written.
- **Shell is `fish`.** Glob-looking arguments (`--include=*.svelte`) must be quoted or they are expanded/rejected.
- **Import paths use the `.js` extension** even for TypeScript sources.
- **Formatter is `oxfmt`** (`bun run format`), not prettier.

---

## File Structure

**Modified — shared primitives (Tasks 1–2):**
- `client/shared/ui/Secret.svelte` — add the empty-string guard. One derived value, no new prop, no new glyph.
- `client/shared/ui/SegmentedControl.svelte` — add `busy?: boolean`; wrap the radiogroup in a shell so the caption can sit outside the bordered, `overflow: hidden` control.

**Modified — call sites (Tasks 3, 5):**
- `client/settings/components/ConfigFieldRow.svelte:133` — pass `busy={saving}`.
- `client/settings/sections/TaskProviderSection.svelte` — add a `.settings-provision__reveal` style rule.

**Modified — fixture (Task 1):**
- `client/stories/msw/settings-handlers-task-provider.ts:31` — `value: ''` → `value: '****WvfQ'`.

**Created — story + visual spec (Task 4):**
- `client/shared/ui/SegmentedControl.stories.svelte` — one story, `Busy`. The primitive currently has no stories file at all, which is why the busy frame has nowhere else to live. Exactly one story, because the audit floor moves by exactly one.
- `tests/visual/shared/ui/SegmentedControl.spec.ts` — generated by `bun shoot:gen`, plus the manual `pinDefaultViewport()` line every sibling spec carries.

**Modified — tests:**
- `tests/client/shared/ui/Secret.test.ts` — two added cases (Task 1).
- `tests/client/shared/ui/SegmentedControl.test.ts` — three added cases (Task 2).
- `tests/client/settings/components/ConfigFieldRow.test.ts` — one added case (Task 3).

**Modified — docs (Task 6):**
- `docs/ux-reviews/TaskProviderSection.md` — two findings to `fixed`, scorecard dimensions 4 and 8 back to `pass`.
- `docs/ux-reviews/AiOutputSection.md` — one finding to `fixed`, scorecard dimension 9 back to `pass`.
- `docs/ux-reviews/_BACKLOG.md` — regenerated, never hand-edited.

**Must NOT be touched:** `client/shared/ui/SummaryList.svelte`, `client/settings/lib/mask-secret.ts`, `docs/ux-reviews/DebugApp.md`, any pre-existing test assertion.

---

## Task 1: `Secret` empty-value guard + fixture correction

Closes `task-provider-empty-secret-blank-pill` (Med). The finding reports a sensitive field with `hasValue: true` and `value: ''` rendering a blank masked pill. **That state is unreachable in production** — `maskSensitiveValue` (`src/config.ts:144-146`) returns `` `****${value.slice(-4)}` ``, never empty, and all three routes feeding `ConfigFieldRow` (`config-routes.ts:38,49`, `byok-field-response.ts:75,79`, `coding-credentials-routes.ts:68,75`) gate on non-empty raw input before masking. The `Bound` fixture invented the state. So this task does two deliberately different things: it corrects the fixture, and it adds a one-branch defense-in-depth guard to the primitive.

**Files:**
- Modify: `client/shared/ui/Secret.svelte:11-16`
- Modify: `client/stories/msw/settings-handlers-task-provider.ts:31`
- Test: `tests/client/shared/ui/Secret.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Secret`'s `value?: string` prop keeps its exact current signature. The only behavioural change is that `''` now renders `'••••••••'` instead of nothing. No new prop, no new export.

- [ ] **Step 1: Write the failing tests**

Append these two tests inside the existing `describe('Secret.svelte', ...)` block in `tests/client/shared/ui/Secret.test.ts`, immediately before its closing `})`:

```ts
  test('falls back to the eight-bullet default when the value is an empty string', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Secret, { target, props: { value: '' } })
    expect(target.querySelector('.ui-secret__value')?.textContent).toBe('••••••••')
    void unmount(c)
  })

  test('renders the real masked value untouched when it is non-empty', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Secret, { target, props: { value: '••••WvfQ' } })
    expect(target.querySelector('.ui-secret__value')?.textContent).toBe('••••WvfQ')
    void unmount(c)
  })
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `bun test tests/client/shared/ui/Secret.test.ts`

Expected: the empty-string test FAILS with something like `Expected: "••••••••"  Received: ""`. The non-empty test PASSES already — it is the regression guard proving the fix does not touch the normal path.

- [ ] **Step 3: Add the guard**

In `client/shared/ui/Secret.svelte`, replace this block:

```svelte
  interface Props { value?: string; hint?: string; onReveal?: () => void }
  let { value = '••••••••', hint, onReveal }: Props = $props()
```

with:

```svelte
  const PLACEHOLDER = '••••••••'

  interface Props { value?: string; hint?: string; onReveal?: () => void }
  let { value = PLACEHOLDER, hint, onReveal }: Props = $props()

  // A Svelte prop default fires only when the prop is `undefined`, so an explicit ''
  // slipped past it and rendered a blank pill. Defense-in-depth: no current route can
  // emit an empty masked secret (src/config.ts:144-146 always returns `****xxxx`).
  const shown = $derived(value === '' ? PLACEHOLDER : value)
```

and change the value span from `{value}` to `{shown}`:

```svelte
  <span class="ui-secret__value">{shown}</span>
```

Leave `hint` and `onReveal` exactly as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/client/shared/ui/Secret.test.ts`

Expected: PASS, 5 tests (3 pre-existing + 2 new).

- [ ] **Step 5: Correct the fixture**

In `client/stories/msw/settings-handlers-task-provider.ts`, in the `kaneo_apikey` field, change:

```ts
      value: '',
```

to:

```ts
      // Server-shape masked value: maskSensitiveValue() (src/config.ts:144-146) always
      // returns `****` + the last four characters, never an empty string. The previous ''
      // fabricated a state no route can produce.
      value: '****WvfQ',
```

- [ ] **Step 6: Run the touched suites and the type/lint gates**

Run: `bun test tests/client/shared/ui/Secret.test.ts tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: PASS, no failures.

Run: `bun run typecheck && bun run lint`
Expected: both clean, no output beyond the tools' own summaries.

- [ ] **Step 7: Re-shoot and read the `Bound` baseline**

With Storybook warm (`bun storybook` in another terminal), run:

```bash
bun shoot -g TaskProviderSection
```

Then read the PNG with the Read tool:

`.storybook-shots/settings/sections/TaskProviderSection.spec.ts/settings-sections-TaskProviderSection-Bound-1.png`

Expected, and you must state it explicitly in your report: the "Kaneo API key" row now shows a masked pill reading **`••••WvfQ`**, not the ~20px empty grey pill the finding described. Do not report "the audit is green" — after `bun shoot` it is green by construction. Describe what you saw in the image.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add client/shared/ui/Secret.svelte client/stories/msw/settings-handlers-task-provider.ts tests/client/shared/ui/Secret.test.ts
git commit -m "fix(ui): render Secret's placeholder for an empty masked value

Correct the TaskProvider Bound fixture, which fabricated a hasValue+empty-value
state no server route can emit, and guard Secret so an explicit '' falls back to
its existing eight-bullet default instead of a blank pill.

Closes task-provider-empty-secret-blank-pill."
```

---

## Task 2: `SegmentedControl` busy state

Closes the primitive half of `ai-output-toggle-no-feedback` (Low). Today `ConfigFieldRow.saveEnum` passes `disabled={saving}` and the control dims to `opacity: 0.5` — indistinguishable from a merely-disabled control, and invisible to assistive tech. The text-field `Save` button in the same primitive already swaps its label to `Saving…` (`ConfigFieldRow.svelte:177`), but a segmented control cannot borrow that: its labels *are* its values.

A static caption was chosen over the finding's suggested pulsing accent because it needs no `prefers-reduced-motion` fallback, is deterministic to screenshot, reuses the codebase's existing busy wording, and — paired with `aria-busy` — actually reaches screen-reader users.

**Why a wrapper element is required:** `.ui-seg` is `display: inline-flex` with a border and `overflow: hidden`. A caption placed inside it would be clipped and enclosed by the control's border. The caption must be a sibling of `.ui-seg` inside a new shell.

**Do not edit `client/shared/ui/Seg.svelte`.** It is a separate primitive that also uses a `.ui-seg` class name (`.ui-seg__btn`, `.ui-seg__btn--active`). This task touches `SegmentedControl.svelte` only.

**Files:**
- Modify: `client/shared/ui/SegmentedControl.svelte:11-20,31,47,49-55`
- Test: `tests/client/shared/ui/SegmentedControl.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `SegmentedControl` gains `busy?: boolean`, defaulting to `false`. When `true` it renders `<span class="ui-seg__busy">Saving…</span>` as a sibling of `.ui-seg`, and sets `aria-busy="true"` on the `role="radiogroup"` element. `busy` is purely presentational plus aria — it does **not** block interaction. `disabled` continues to carry all behavioural blocking. Task 3 passes `busy={saving}` alongside the existing `disabled={saving}`.

- [ ] **Step 1: Write the failing tests**

Append these three tests inside the existing `describe` block in `tests/client/shared/ui/SegmentedControl.test.ts`, immediately before its closing `})`. The file already defines `const options = [{ value: 'allow', label: 'Allow' }, { value: 'ask', label: 'Ask' }, { value: 'deny', label: 'Deny' }]` — reuse it.

```ts
  test('renders the Saving… caption and aria-busy when busy', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SegmentedControl, {
      target,
      props: { options, value: 'ask', ariaLabel: 'Mode', onChange: () => {}, busy: true },
    })
    expect(target.querySelector('.ui-seg__busy')?.textContent).toBe('Saving…')
    expect(target.querySelector('[role="radiogroup"]')?.getAttribute('aria-busy')).toBe('true')
    void unmount(c)
  })

  test('renders no caption and no aria-busy by default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SegmentedControl, {
      target,
      props: { options, value: 'ask', ariaLabel: 'Mode', onChange: () => {} },
    })
    expect(target.querySelector('.ui-seg__busy')).toBeNull()
    expect(target.querySelector('[role="radiogroup"]')?.hasAttribute('aria-busy')).toBe(false)
    void unmount(c)
  })

  test('busy alone does not block interaction — only disabled does', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let picked = ''
    const c = mount(SegmentedControl, {
      target,
      props: {
        options,
        value: 'ask',
        ariaLabel: 'Mode',
        busy: true,
        onChange: (v: string) => {
          picked = v
        },
      },
    })
    target.querySelectorAll<HTMLButtonElement>('.ui-seg__opt')[2]!.click()
    expect(picked).toBe('deny')
    void unmount(c)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test:client -t 'busy'`

Expected: the first two FAIL (`Received: undefined` for the caption text; `Received: null` or `true` for the aria-busy assertions). The third may pass already, since `busy` is currently an ignored prop — it is the guard proving `busy` never becomes a second `disabled`.

- [ ] **Step 3: Add the prop, the shell, and the caption**

In `client/shared/ui/SegmentedControl.svelte`, add `busy?: boolean` to `Props` and destructure it with a `false` default:

```svelte
  interface Props {
    options: readonly Option[]
    value: string
    ariaLabel: string
    onChange: (value: string) => void
    testidPrefix?: string
    disabled?: boolean
    ariaDescribedBy?: string
    busy?: boolean
  }
  let {
    options,
    value,
    ariaLabel,
    onChange,
    testidPrefix,
    disabled = false,
    ariaDescribedBy,
    busy = false,
  }: Props = $props()
```

Leave `onKey` exactly as it is — it gates on `disabled`, not `busy`.

Wrap the existing radiogroup in a shell and append the caption. Replace the opening `<div class="ui-seg" ...>` line and the closing `</div>` of the radiogroup with:

```svelte
<div class="ui-seg-shell">
  <div
    class="ui-seg"
    role="radiogroup"
    aria-label={ariaLabel}
    aria-describedby={ariaDescribedBy}
    aria-busy={busy ? 'true' : undefined}>
    {#each options as opt, i (opt.value)}
      <button
        type="button"
        role="radio"
        aria-checked={value === opt.value ? 'true' : 'false'}
        tabindex={value === opt.value ? 0 : -1}
        class="ui-seg__opt"
        class:ui-seg__opt--on={value === opt.value}
        {disabled}
        data-testid={testidPrefix ? `${testidPrefix}-${opt.value}` : undefined}
        onclick={() => onChange(opt.value)}
        onkeydown={(e) => onKey(e, i)}>
        {opt.label}
      </button>
    {/each}
  </div>
  {#if busy}<span class="ui-seg__busy">Saving…</span>{/if}
</div>
```

Add two rules at the top of the `<style>` block, above the existing `.ui-seg` rule. The shell is `inline-flex` to preserve `.ui-seg`'s own former `inline-flex` outer behaviour in both flex and block parents:

```css
  .ui-seg-shell {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-tight);
  }
  .ui-seg__busy {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
  }
```

Leave every other rule untouched — in particular `.ui-seg__opt:disabled { cursor: not-allowed; opacity: 0.5; }` stays, because the busy dim is the existing disabled dim.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:client -t 'SegmentedControl'`
Expected: PASS, 14 tests (11 pre-existing + 3 new).

Run: `bun run test:client`
Expected: PASS across the whole client suite. If any pre-existing client test now fails, **stop and escalate** — do not edit it. A failure here most likely means the new shell changed a DOM shape another test asserts on, which is exactly the signal this step exists to catch.

- [ ] **Step 5: Type and lint gates**

Run: `bun run typecheck && bun run lint`
Expected: both clean.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add client/shared/ui/SegmentedControl.svelte tests/client/shared/ui/SegmentedControl.test.ts
git commit -m "feat(ui): give SegmentedControl a busy state

Add an optional busy prop that renders a 'Saving…' caption beside the control
and sets aria-busy on the radiogroup, reusing the wording the text-field Save
button already uses. busy is presentational plus aria only; disabled still
carries all behavioural blocking. Defaults to false, so existing consumers are
unchanged."
```

---

## Task 3: `ConfigFieldRow` passes `busy`

Wires the primitive from Task 2 to the call site the finding is filed against.

**Files:**
- Modify: `client/settings/components/ConfigFieldRow.svelte:133`
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts`

**Interfaces:**
- Consumes: `SegmentedControl`'s `busy?: boolean` prop from Task 2, which renders `<span class="ui-seg__busy">Saving…</span>` and sets `aria-busy="true"` on the `role="radiogroup"` element.
- Produces: nothing later tasks depend on in code. Task 6 cites this commit in the `ai-output-toggle-no-feedback` resolution line.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('ConfigFieldRow', ...)` block in `tests/client/settings/components/ConfigFieldRow.test.ts`, immediately before its closing `})`. The file already defines the `json`, `bodyString`, `drain`, and `render` helpers at the top — reuse them.

The test holds the PATCH open with a never-resolving promise so the in-flight frame is observable, then asserts the caption is gone once the request settles.

```ts
  test('an enum field shows the SegmentedControl busy caption while saving', async () => {
    setCsrfToken('c')
    let release: (r: Response) => void = () => {}
    setMockFetch(() =>
      new Promise<Response>((resolve) => {
        release = resolve
      }))
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'ai_tool_visibility',
        storageKey: 'ai_tool_visibility',
        label: 'Show tool calls',
        required: false,
        sensitive: false,
        kind: 'ai-output',
        control: 'toggle',
        options: [
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ],
        hasValue: false,
        value: 'off',
      },
      onSaved: () => {},
    })
    flushSync()
    expect(target.querySelector('.ui-seg__busy')).toBeNull()

    target.querySelector<HTMLButtonElement>('[data-testid="cfg-seg-ai_tool_visibility-on"]')!.click()
    await drain()
    expect(target.querySelector('.ui-seg__busy')?.textContent).toBe('Saving…')
    expect(target.querySelector('[role="radiogroup"]')?.getAttribute('aria-busy')).toBe('true')

    release(json({ ok: true, contextId: 'user:1' }))
    await drain()
    expect(target.querySelector('.ui-seg__busy')).toBeNull()
    void unmount(component)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:client -t 'busy caption'`

Expected: FAIL at the mid-flight assertion — `Expected: "Saving…"  Received: undefined` — because `ConfigFieldRow` does not yet pass `busy`.

- [ ] **Step 3: Pass the prop**

In `client/settings/components/ConfigFieldRow.svelte`, in the `{#if isEnum}` branch, add `busy={saving}` to the `SegmentedControl` immediately after the existing `disabled={saving}`:

```svelte
      <SegmentedControl
        options={field.options ?? []}
        value={current}
        ariaLabel={field.label}
        ariaDescribedBy={segmentedDescribedBy(errorId)}
        disabled={saving}
        busy={saving}
        onChange={(v) => void saveEnum(v)}
        testidPrefix={`cfg-seg-${field.key}`} />
```

Change nothing else in the file — `saveEnum` already manages `saving` correctly in its `finally` block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test:client`
Expected: PASS across the whole client suite, including the new case. If a pre-existing client test now fails, **stop and escalate** — do not edit it.

Run: `bun run typecheck && bun run lint`
Expected: both clean.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "fix(settings): show a busy caption while an enum field saves

Pass busy={saving} to SegmentedControl so a slow enum save is distinguishable
from a merely-disabled control and is announced via aria-busy.

Closes ai-output-toggle-no-feedback."
```

---

## Task 4: Busy-frame visual baseline

Adds the one new baseline this project is allowed (audit 466 → 467) and proves the shell wrapper from Task 2 did not move any existing consumer's pixels.

`SegmentedControl` currently has **no** stories file and **no** visual spec, which is why the busy frame has nowhere else to live. The story is captured at the primitive rather than through `AiOutputSection` because an in-flight network frame is not deterministically screenshottable through MSW, whereas a `busy: true` arg is.

**Exactly one story.** A `Default` story would be a second baseline and would put the audit at 468, contradicting the spec's floor.

**Files:**
- Create: `client/shared/ui/SegmentedControl.stories.svelte`
- Create: `tests/visual/shared/ui/SegmentedControl.spec.ts` (generated, then one manual line added)

**Interfaces:**
- Consumes: `SegmentedControl`'s `busy?: boolean` prop from Task 2.
- Produces: story id `shared-ui-segmentedcontrol--busy`. No code depends on it.

- [ ] **Step 1: Create the story**

Create `client/shared/ui/SegmentedControl.stories.svelte` with exactly this content. It follows the sibling `Seg.stories.svelte` pattern.

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import SegmentedControl from './SegmentedControl.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/SegmentedControl',
    component: SegmentedControl,
  })
</script>

<!-- One story only: this file exists to pin the busy frame, and the audit floor
     moves by exactly one baseline for this project. -->
<Story
  name="Busy"
  args={{
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
    value: 'on',
    ariaLabel: 'Show tool calls',
    disabled: true,
    busy: true,
    onChange: () => {},
  }} />
```

- [ ] **Step 2: Generate the visual spec**

Run: `bun run shoot:gen`

This regenerates the `@generated-begin auto-screenshots` region in **every** visual spec, not just the new one. That is known to produce out-of-scope churn in unrelated specs (`DebugApp`, `LogExplorer`, `SessionsList`, `ToolFailuresPanel`, `TraceList`, `TurnsPanel`, `SummaryList`). Discard all of it — expanding the audit floor for other sections is a separate project.

```bash
git status --porcelain tests/visual/
git restore tests/visual/
git status --porcelain tests/visual/
```

Expected after the restore: exactly one line, `?? tests/visual/shared/ui/SegmentedControl.spec.ts`. The `git restore` reverts tracked modifications and leaves the new untracked file alone. If any other untracked spec appears, stop and escalate.

- [ ] **Step 3: Add the shared viewport pin**

The generator does not emit the manual region. Append these lines to `tests/visual/shared/ui/SegmentedControl.spec.ts`, below the `// @generated-end auto-screenshots` marker, matching `tests/visual/shared/ui/Seg.spec.ts:27-29`:

```ts
import { pinDefaultViewport } from '../../support/viewport.js'

pinDefaultViewport()
```

- [ ] **Step 4: Shoot the new baseline**

With Storybook warm, run:

```bash
bun shoot -g SegmentedControl
```

Expected: 1 passing test, one PNG written.

- [ ] **Step 5: Read the new PNG**

Read with the Read tool:

`.storybook-shots/shared/ui/SegmentedControl.spec.ts/shared-ui-SegmentedControl-Busy-1.png`

Expected, and you must describe it explicitly: a two-segment `Off`/`On` control with `On` highlighted, the whole control dimmed to half opacity, and the text **`Saving…`** rendered to its right in dim monospace, outside the control's border, vertically centred, not clipped and not overlapping the border.

- [ ] **Step 6: Confirm the unaffected consumers did not move**

The shell wrapper from Task 2 is the risk this step exists for. Run the audit **unfiltered** — `-g` would require guessing which spec file each consumer lives in, and an unfiltered run answers the question directly:

```bash
bun run visual:audit
```

Note this is `visual:audit`, **not** `bun shoot` — it compares against the committed baselines instead of overwriting them, which is the only way this check means anything.

Expected: 467 passing, 0 failing. Everything except the story added in this task is comparing against a baseline shot before Task 2, so a pass is real evidence here.

Pay particular attention to the consumers named in the spec: the three other `SegmentedControl` consumers (`ToolsSection`, `AnalyticsPreferencesSection`, `SettingsFieldShell`) and the five debug `SummaryList` panels (`TraceDetail`, `LogDetail`, `FailureDetail`, `TurnDetail`, `SessionDetail`). A diff in any of those means the shell leaked past its intended scope: report it and stop rather than accepting the new pixels.

- [ ] **Step 7: Commit**

```bash
bun run format
git add client/shared/ui/SegmentedControl.stories.svelte tests/visual/shared/ui/SegmentedControl.spec.ts
git commit -m "test(visual): pin the SegmentedControl busy frame

One story, one baseline: the audit floor moves 466 -> 467. Captured at the
primitive because an in-flight MSW frame is not deterministically screenshottable
through AiOutputSection."
```

---

## Task 5: `TaskProviderSection` provision-reveal inset

Closes `task-provider-summary-list-no-inset` (Low). In `TaskProvider-—-provision-reveal-1.png` at 1280px, `demo-user@example.invalid` and `https://kaneo.example` terminate flush against the viewport edge (x≈1280) while the sibling `ConfigFieldRow` cards inset their content (their `Clear` button ends at x≈1264).

`.settings-provision__reveal` currently has **no style rule at all** — it is an unstyled `<div>`. The fix adds one.

**`client/shared/ui/SummaryList.svelte` must not be touched** — see Global Constraints for why.

**Files:**
- Modify: `client/settings/sections/TaskProviderSection.svelte` `<style>` block (after the `.settings-provision` rule, around `:193-199`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on in code. Task 6 cites this commit in the finding's resolution line.

- [ ] **Step 1: Read the current baseline**

Before changing anything, read the PNG with the Read tool so you can compare afterwards:

`.storybook-shots/settings/sections/TaskProviderSection.spec.ts/TaskProvider-—-provision-reveal-1.png`

Note where the `Email` and `Kaneo URL` values end relative to the `Clear` button above them. You will need that comparison in Step 4.

- [ ] **Step 2: Add the style rule**

In `client/settings/sections/TaskProviderSection.svelte`, in the `<style>` block, add this rule immediately after the `.settings-provision` rule and before `.provision-actions`:

```css
  .settings-provision__reveal {
    padding-inline: var(--gap-inline);
  }
```

`--gap-inline` is 12px (`client/shared/tokens.css:51`), the same token `SettingsFieldShell.svelte:81` uses for the sibling cards' `padding`. Do not substitute a literal px value.

- [ ] **Step 3: Re-shoot**

```bash
bun shoot -g TaskProviderSection
```

- [ ] **Step 4: Read the PNG and check alignment**

Read: `.storybook-shots/settings/sections/TaskProviderSection.spec.ts/TaskProvider-—-provision-reveal-1.png`

**The acceptance criterion is alignment, not a pixel count.** The `Email` and `Kaneo URL` values' right edge must line up with the sibling `Clear` button's right edge above them. Describe explicitly in your report what you saw and whether the edges line up.

If `var(--gap-inline)` alone does not achieve alignment, **do not hand-tune a px value.** The reveal block then needs the same container treatment as the cards — report what you observed and escalate rather than guessing a number. Matching the token scale is the entire point of the finding.

Also confirm `Bound-1.png` still shows `••••WvfQ` from Task 1 — `bun shoot -g TaskProviderSection` rewrites it too.

- [ ] **Step 5: Gates**

Run: `bun run typecheck && bun run lint`
Expected: both clean.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add client/settings/sections/TaskProviderSection.svelte
git commit -m "fix(settings): inset the Kaneo provision-reveal block

Give .settings-provision__reveal padding-inline: var(--gap-inline), the token the
sibling ConfigFieldRow cards already use, so revealed SummaryList values no longer
sit flush at the container edge. Fixed at the call site, not in SummaryList: five
of its six consumers already get padding from DebugDetailRail.

Closes task-provider-summary-list-no-inset."
```

---

## Task 6: Documentation close-out

Flips three findings to `fixed` with real commit hashes, re-scores three scorecard dimensions, and regenerates the backlog.

**The backlog parser fails loud if a non-`open` finding has no `- **Resolved:**` line.** Use the actual hashes from Tasks 1, 3, and 5 — get them with `git log --oneline -8`. Do not invent or abbreviate them inconsistently; the repo convention is a 9-character short hash.

**`debug-icon-buttons-control-height` stays `open`.** Its `superseded` recommendation was carved out of spec approval and has not been signed off. Do not touch `docs/ux-reviews/DebugApp.md` — the finding already carries its WCAG 2.2 SC 2.5.8 analysis and its warning against local "fixes" in `DebugApp` in an existing `- **Note:**` line, so the decision is already recorded in the doc whichever way it eventually goes. Report it as still open and pending sign-off in Task 7.

**Files:**
- Modify: `docs/ux-reviews/TaskProviderSection.md`
- Modify: `docs/ux-reviews/AiOutputSection.md`
- Regenerate: `docs/ux-reviews/_BACKLOG.md`

**Interfaces:**
- Consumes: the commit hashes produced by Tasks 1, 3, and 5.
- Produces: a `_BACKLOG.md` at 23 open, with `TaskProviderSection` at 0 open and `AiOutputSection` at 1 open.

- [ ] **Step 1: Collect the commit hashes**

Run: `git log --oneline -8`

Record three hashes: the `Secret`/fixture commit (Task 1), the `ConfigFieldRow` busy commit (Task 3), and the reveal-inset commit (Task 5). Referred to below as `<T1>`, `<T3>`, `<T5>`.

- [ ] **Step 2: Close `task-provider-empty-secret-blank-pill`**

In `docs/ux-reviews/TaskProviderSection.md`, change that finding's `- **Status:** open` to `- **Status:** fixed` and insert a `- **Resolved:**` line directly after it. The resolution text **must** record that production cannot reach the empty state, or a future reader will conclude the server once emitted blank secrets and reason from a false premise.

```markdown
- **Status:** fixed
- **Resolved:** `<T1>`. Two changes. The fixture was wrong: `client/stories/msw/settings-handlers-task-provider.ts`
  set `hasValue: true` with `value: ''`, a state **no production route can emit** —
  `maskSensitiveValue` (`src/config.ts:144-146`) returns `` `****${value.slice(-4)}` ``, never
  empty, and all three routes feeding `ConfigFieldRow` gate on non-empty raw input before
  masking (`config-routes.ts:38,49`, `byok-field-response.ts:75,79`,
  `coding-credentials-routes.ts:68,75`). The fixture now carries a server-shaped
  `'****WvfQ'`, and `Bound-1.png` reads `••••WvfQ`. Separately, `client/shared/ui/Secret.svelte`
  now treats an empty string like an absent value, falling back to its own existing
  `'••••••••'` default — a Svelte prop default fires only for `undefined`, so the explicit `''`
  from `maskSecret` slipped past it. That guard is defense-in-depth for a future route that
  bypasses `maskSensitiveValue`, not a fix for a live defect. `maskSecret` was deliberately left
  alone so it stays a pure string normalizer and all six `Secret` consumers inherit the guard.
```

- [ ] **Step 3: Close `task-provider-summary-list-no-inset`**

In the same file:

```markdown
- **Status:** fixed
- **Resolved:** `<T5>`. `client/settings/sections/TaskProviderSection.svelte` gives
  `.settings-provision__reveal` — previously an entirely unstyled `<div>` —
  `padding-inline: var(--gap-inline)`, the same 12px token the sibling `ConfigFieldRow` cards
  use via `SettingsFieldShell.svelte:81`. Revealed values now align with the `Clear` button's
  right edge instead of terminating at the container edge.
  `client/shared/ui/SummaryList.svelte` was deliberately **not** modified: five of its six
  consumers are debug detail panels rendered inside `DebugDetailRail`, which already supplies
  `padding: 16px` (`DebugDetailRail.svelte:81`), so padding the primitive would double-pad five
  correct consumers to fix one broken one.
```

- [ ] **Step 4: Re-score the `TaskProviderSection` scorecard**

Dimension 4 currently reads `warn` solely because of the blank-pill finding, and dimension 8 solely because of the inset finding. Both return to `pass`. Replace those two rows with:

```markdown
| 4. Feedback & state             | pass  | Loading/empty/bind-success/friendly-error are all handled well, the null-vs-bound `Select` selection is correct (`resolveTaskInstanceSelection` leaves the control unselected with a placeholder until something is bound), and a stored secret now always renders a visible masked pill — `Secret` falls back to its `'••••••••'` default for an empty value, and the fixture that fabricated that state has been corrected to the server's real `****xxxx` shape. |
| 8. Spacing, alignment & sizing  | pass  | `.settings-field-list` gap is tokenized (`--gap-inline`), the provision block's hardcoded `gap: 8px`/`padding-top: 8px` numerically match `--gap-tight`, and the provision-reveal block now carries `padding-inline: var(--gap-inline)`, so revealed `SummaryList` values align with the sibling `ConfigFieldRow` cards instead of sitting flush at the container edge. |
```

- [ ] **Step 5: Close `ai-output-toggle-no-feedback` and re-score dimension 9**

In `docs/ux-reviews/AiOutputSection.md`, flip that finding to `fixed` and add:

```markdown
- **Status:** fixed
- **Resolved:** `<T3>`. `client/shared/ui/SegmentedControl.svelte` gained an optional
  `busy?: boolean` prop (default `false`) that renders a `Saving…` caption beside the control
  and sets `aria-busy="true"` on the `role="radiogroup"` element;
  `client/settings/components/ConfigFieldRow.svelte` passes `busy={saving}` alongside its
  existing `disabled={saving}`. The wording reuses the text-field `Save` button's existing
  `Saving…` label. A static caption was chosen over the suggested pulsing accent because it
  needs no `prefers-reduced-motion` fallback, is deterministic to screenshot, and — paired with
  `aria-busy` — reaches screen-reader users, which an opacity change never did. The frame is
  pinned by `.storybook-shots/shared/ui/SegmentedControl.spec.ts/shared-ui-SegmentedControl-Busy-1.png`. `busy` is
  presentational plus aria only; `disabled` still carries all behavioural blocking, so the three
  other consumers are unchanged.
```

Replace the dimension 9 row with:

```markdown
| 9. Interaction & micro-states   | pass  | Hover/focus-visible are present on the segment and icon-button, the segmented control disables while saving with a visible error line on failure, and it now carries a distinct busy affordance — a `Saving…` caption plus `aria-busy="true"` — so an in-flight save is no longer indistinguishable from a plain disabled state. |
```

- [ ] **Step 6: Regenerate the backlog and run the parser test**

```bash
bun run ux:backlog
bun test tests/scripts/ux-backlog.test.ts
```

Expected: the parser test passes (21/21). If it fails on a missing `Resolved` line, a hash placeholder was left unsubstituted — fix the doc, not the parser.

- [ ] **Step 7: Verify the counts the generator actually produced**

Read `docs/ux-reviews/_BACKLOG.md` and confirm:
- Header reads **23 open finding(s)**.
- `TaskProviderSection` row: **0 open**, 8 fixed.
- `AiOutputSection` row: **1 open**, 7 fixed.
- `DebugApp` row: still **1 open** — `debug-icon-buttons-control-height` is untouched.
- Med drops from 5 to 4; Low drops from 21 to 19.

**Report what the generator actually produced.** If a number differs, report the difference rather than editing the generated file — it is generated, never hand-edited.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add docs/ux-reviews/
git commit -m "docs(ux): close three findings and re-score two scorecards

TaskProviderSection reaches 0 open. Backlog 26 -> 23.
debug-icon-buttons-control-height remains open — its superseded recommendation
has not been signed off."
```

---

## Task 7: Unfiltered gates and evidence

The per-task checks were all scoped. This task runs everything unfiltered, which is the only run that counts.

**Files:** none modified. This task produces evidence, not code. If a gate fails, report it — do not fix it by weakening the gate.

**Interfaces:**
- Consumes: the complete state after Tasks 1–6.
- Produces: the evidence record for the project's success criteria.

- [ ] **Step 1: Full test suite**

Two commands — `bunfig.toml:8` excludes `tests/client/**` from default discovery, so `bun test` alone would silently skip every test this project added.

Run: `bun test`
Expected: PASS, no failures. Record the totals.

Run: `bun run test:client`
Expected: PASS, no failures. Record the totals separately.

- [ ] **Step 2: Full visual audit, unfiltered**

Run: `bun run visual:audit`

Expected: **467 passing**, up from 466. `-g` is diagnosis only and must not be used here.

Note that the audit is green by construction for everything re-shot in Tasks 1, 4, and 5 — it proves only that nothing *else* moved. The PNG readings in Tasks 1, 4, and 5 are the real evidence.

If the count is 468 or higher, an extra baseline leaked in — most likely an unreverted `shoot:gen` region from Task 4 Step 2. Report it.

- [ ] **Step 3: Security scan**

Run: `bun security`
Expected: clean.

- [ ] **Step 4: Confirm the working tree is clean and nothing was pushed**

```bash
git status --porcelain
git log --oneline master..HEAD | head -10
git branch --show-current
```

Expected: empty `git status` output (`.storybook-shots/` is git-ignored, so re-shot PNGs never appear here); branch is `ui-ux-review-01`; the log shows this project's commits sitting unpushed on top of the branch's earlier sub-projects.

- [ ] **Step 5: Report**

Summarise, with the actual observed values:
- The three findings closed, with their commit hashes.
- Backlog: 26 → the number the generator produced.
- Audit: 466 → the number `visual:audit` reported.
- What each of the three read PNGs showed, in your own words.
- The unaffected-consumer check from Task 4 Step 6: passed clean, or what moved.
- `debug-icon-buttons-control-height` still `open`, pending sign-off.

No commit — this task produces no file changes.

---

## Notes for the reviewer

Three things in this plan look like defects but are deliberate; each is argued in the spec:

1. **`Secret`'s guard fires on a state production cannot reach.** That is stated as defense-in-depth, not as a bug fix, and the finding's resolution text records the route analysis so a later reader does not infer the server once emitted blank secrets.
2. **A fixture is being corrected to remove a rendered defect.** The standing rule from the predecessor project is never to prettify a fixture to hide a defect. This is the mirror case: the fixture fabricated a state no server route can emit. The distinction is written into the resolution text for exactly this reason.
3. **`SegmentedControl.stories.svelte` has one story and no `Default`.** A second story would be a second baseline and would put the audit at 468, contradicting the spec's floor of 467.

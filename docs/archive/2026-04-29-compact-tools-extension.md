<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Compact Tools Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global pi extension that overrides `read`, `bash`, `edit`, and `write` built-in tools with compact TUI renderers while preserving full LLM context.

**Architecture:** Single flat file at `~/.pi/agent/extensions/compact-tools.ts`. Each tool is re-registered by name with delegate execution to the original via `create*Tool()` factory functions. Custom `renderCall` and `renderResult` functions provide compact one-line summaries with expand-on-demand via `Ctrl+E`.

**Tech Stack:** TypeScript, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`

---

### Task 1: Scaffold Extension File with Imports

**Files:**

- Create: `~/.pi/agent/extensions/compact-tools.ts`

- [ ] **Step 1: Create the extension file with imports and factory function**

```typescript
import type { BashToolDetails, EditToolDetails, ExtensionAPI, ReadToolDetails } from '@mariozechner/pi-coding-agent'
import { createBashTool, createEditTool, createReadTool, createWriteTool } from '@mariozechner/pi-coding-agent'
import { Text } from '@mariozechner/pi-tui'

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd()
}
```

- [ ] **Step 2: Verify file exists at correct path**

Run: `cat ~/.pi/agent/extensions/compact-tools.ts`
Expected: File exists with the content above.

---

### Task 2: Add Read Tool Override

**Files:**

- Modify: `~/.pi/agent/extensions/compact-tools.ts`

- [ ] **Step 1: Add read tool override inside the factory function (after `const cwd = process.cwd();`)**

```typescript
const originalRead = createReadTool(cwd)
pi.registerTool({
  name: 'read',
  label: 'read',
  description: originalRead.description,
  parameters: originalRead.parameters,

  async execute(toolCallId, params, signal, onUpdate) {
    return originalRead.execute(toolCallId, params, signal, onUpdate)
  },

  renderCall(args, theme, _context) {
    let text = theme.fg('toolTitle', theme.bold('read '))
    text += theme.fg('accent', args.path)
    if (args.offset || args.limit) {
      const parts: string[] = []
      if (args.offset) parts.push(`offset=${args.offset}`)
      if (args.limit) parts.push(`limit=${args.limit}`)
      text += theme.fg('dim', ` (${parts.join(', ')})`)
    }
    return new Text(text, 0, 0)
  },

  renderResult(result, { expanded, isPartial }, theme, _context) {
    if (isPartial) return new Text(theme.fg('warning', 'Reading...'), 0, 0)

    const details = result.details as ReadToolDetails | undefined
    const content = result.content[0]

    if (content?.type === 'image') {
      return new Text(theme.fg('success', 'Image loaded'), 0, 0)
    }

    if (content?.type !== 'text') {
      return new Text(theme.fg('error', 'No content'), 0, 0)
    }

    const lineCount = content.text.split('\n').length
    let text = theme.fg('success', `${lineCount} lines`)

    if (details?.truncation?.truncated) {
      text += theme.fg('warning', ` (truncated from ${details.truncation.totalLines})`)
    }

    if (expanded) {
      const lines = content.text.split('\n').slice(0, 15)
      for (const line of lines) {
        text += `\n${theme.fg('dim', line)}`
      }
      if (lineCount > 15) {
        text += `\n${theme.fg('muted', `... ${lineCount - 15} more lines`)}`
      }
    }

    return new Text(text, 0, 0)
  },
})
```

- [ ] **Step 2: Verify the extension loads without errors**

Run: `pi -e ~/.pi/agent/extensions/compact-tools.ts -p "echo test" 2>&1 | head -5`
Expected: No TypeScript/import errors in output.

---

### Task 3: Add Bash Tool Override

**Files:**

- Modify: `~/.pi/agent/extensions/compact-tools.ts`

- [ ] **Step 1: Add bash tool override after the read tool block**

```typescript
const originalBash = createBashTool(cwd)
pi.registerTool({
  name: 'bash',
  label: 'bash',
  description: originalBash.description,
  parameters: originalBash.parameters,

  async execute(toolCallId, params, signal, onUpdate) {
    return originalBash.execute(toolCallId, params, signal, onUpdate)
  },

  renderCall(args, theme, _context) {
    let text = theme.fg('toolTitle', theme.bold('$ '))
    const cmd = args.command.length > 80 ? `${args.command.slice(0, 77)}...` : args.command
    text += theme.fg('accent', cmd)
    if (args.timeout) {
      text += theme.fg('dim', ` (timeout: ${args.timeout}s)`)
    }
    return new Text(text, 0, 0)
  },

  renderResult(result, { expanded, isPartial }, theme, _context) {
    if (isPartial) return new Text(theme.fg('warning', 'Running...'), 0, 0)

    const details = result.details as BashToolDetails | undefined
    const content = result.content[0]
    const output = content?.type === 'text' ? content.text : ''

    const exitMatch = output.match(/exit code: (\d+)/)
    const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null
    const lineCount = output.split('\n').filter((l) => l.trim()).length

    let text = ''
    if (exitCode === 0 || exitCode === null) {
      text += theme.fg('success', 'done')
    } else {
      text += theme.fg('error', `exit ${exitCode}`)
    }
    text += theme.fg('dim', ` (${lineCount} lines)`)

    if (details?.truncation?.truncated) {
      text += theme.fg('warning', ' [truncated]')
    }

    if (expanded) {
      const lines = output.split('\n').slice(0, 20)
      for (const line of lines) {
        text += `\n${theme.fg('dim', line)}`
      }
      if (output.split('\n').length > 20) {
        text += `\n${theme.fg('muted', '... more output')}`
      }
    }

    return new Text(text, 0, 0)
  },
})
```

- [ ] **Step 2: Verify the extension still loads**

Run: `pi -e ~/.pi/agent/extensions/compact-tools.ts -p "echo test" 2>&1 | head -5`
Expected: No errors.

---

### Task 4: Add Edit Tool Override

**Files:**

- Modify: `~/.pi/agent/extensions/compact-tools.ts`

- [ ] **Step 1: Add edit tool override after the bash tool block**

```typescript
const originalEdit = createEditTool(cwd)
pi.registerTool({
  name: 'edit',
  label: 'edit',
  description: originalEdit.description,
  parameters: originalEdit.parameters,
  renderShell: 'self',

  async execute(toolCallId, params, signal, onUpdate) {
    return originalEdit.execute(toolCallId, params, signal, onUpdate)
  },

  renderCall(args, theme, _context) {
    let text = theme.fg('toolTitle', theme.bold('edit '))
    text += theme.fg('accent', args.path)
    return new Text(text, 0, 0)
  },

  renderResult(result, { expanded, isPartial }, theme, _context) {
    if (isPartial) return new Text(theme.fg('warning', 'Editing...'), 0, 0)

    const details = result.details as EditToolDetails | undefined
    const content = result.content[0]

    if (content?.type === 'text' && content.text.startsWith('Error')) {
      return new Text(theme.fg('error', content.text.split('\n')[0]), 0, 0)
    }

    if (!details?.diff) {
      return new Text(theme.fg('success', 'Applied'), 0, 0)
    }

    const diffLines = details.diff.split('\n')
    let additions = 0
    let removals = 0
    for (const line of diffLines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      if (line.startsWith('-') && !line.startsWith('---')) removals++
    }

    let text = theme.fg('success', `+${additions}`)
    text += theme.fg('dim', ' / ')
    text += theme.fg('error', `-${removals}`)

    if (expanded) {
      for (const line of diffLines.slice(0, 30)) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          text += `\n${theme.fg('success', line)}`
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          text += `\n${theme.fg('error', line)}`
        } else {
          text += `\n${theme.fg('dim', line)}`
        }
      }
      if (diffLines.length > 30) {
        text += `\n${theme.fg('muted', `... ${diffLines.length - 30} more diff lines`)}`
      }
    }

    return new Text(text, 0, 0)
  },
})
```

- [ ] **Step 2: Verify the extension still loads**

Run: `pi -e ~/.pi/agent/extensions/compact-tools.ts -p "echo test" 2>&1 | head -5`
Expected: No errors.

---

### Task 5: Add Write Tool Override

**Files:**

- Modify: `~/.pi/agent/extensions/compact-tools.ts`

- [ ] **Step 1: Add write tool override after the edit tool block**

```typescript
const originalWrite = createWriteTool(cwd)
pi.registerTool({
  name: 'write',
  label: 'write',
  description: originalWrite.description,
  parameters: originalWrite.parameters,

  async execute(toolCallId, params, signal, onUpdate) {
    return originalWrite.execute(toolCallId, params, signal, onUpdate)
  },

  renderCall(args, theme, _context) {
    let text = theme.fg('toolTitle', theme.bold('write '))
    text += theme.fg('accent', args.path)
    const lineCount = args.content.split('\n').length
    text += theme.fg('dim', ` (${lineCount} lines)`)
    return new Text(text, 0, 0)
  },

  renderResult(result, { isPartial }, theme, _context) {
    if (isPartial) return new Text(theme.fg('warning', 'Writing...'), 0, 0)

    const content = result.content[0]
    if (content?.type === 'text' && content.text.startsWith('Error')) {
      return new Text(theme.fg('error', content.text.split('\n')[0]), 0, 0)
    }

    return new Text(theme.fg('success', 'Written'), 0, 0)
  },
})
```

- [ ] **Step 2: Verify the extension still loads**

Run: `pi -e ~/.pi/agent/extensions/compact-tools.ts -p "echo test" 2>&1 | head -5`
Expected: No errors.

---

### Task 6: Install Global and Commit

**Files:**

- Verify: `~/.pi/agent/extensions/compact-tools.ts`

- [ ] **Step 1: Move extension to auto-discovery location (if using -e flag during dev)**

The file is already at `~/.pi/agent/extensions/compact-tools.ts`. This is the global auto-discovery path. Remove `-e` flag usage going forward.

- [ ] **Step 2: Commit the extension file to papai repo for reference**

```bash
cp ~/.pi/agent/extensions/compact-tools.ts /Users/ki/Projects/experiments/papai/.worktrees/pi-migration-scaffold/docs/superpowers/extensions/compact-tools.ts
```

- [ ] **Step 3: Add to git and commit**

Run:

```bash
cd /Users/ki/Projects/experiments/papai/.worktrees/pi-migration-scaffold
git add docs/superpowers/extensions/compact-tools.ts
git commit -m "feat: add compact-tools pi extension"
```

Expected: Commit succeeds with clean checks.

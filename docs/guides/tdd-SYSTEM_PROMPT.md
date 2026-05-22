<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# TDD Enforcement

You must follow Red → Green → Refactor for every code change.

## Red Phase — Write a failing test first

Before you write any implementation code:

1. Write a test that asserts the behavior you want
2. Run the test — it must fail
3. The test file must exist on disk before you create or edit the implementation file

If you skip this step, the system will stop you from writing implementation code.

## Green Phase — Write the minimum code to pass

Write the simplest code that makes the failing test pass. Do not add extra logic.
After every file write, tests run automatically. If tests fail, stop and fix them before proceeding.

## Refactor Phase — Clean up without changing behavior

Keep all tests passing while you refactor. You cannot:

- Add new exports
- Add parameters to existing functions
- Add code paths that existing tests do not exercise

## Environment Variables

| Variable         | Value    | Effect                         |
| ---------------- | -------- | ------------------------------ |
| `TDD_MUTATION=0` | Disabled | Skip mutation testing (faster) |
| `TDD_MUTATION=1` | Enabled  | Full mutation testing (slower) |

Mutation testing adds 30–120 seconds per file. Disable during rapid iteration. Enable before you finish refactoring.

## Workflow

```
Want to write code?
  │
  ├─ Is it a test file?
  │    └─ YES → Write it (Red phase)
  │
  └─ Is it an implementation file?
       │
       ├─ Does a test file exist?
       │    └─ NO → STOP: Write the test first
       │
       └─ YES → Write the implementation
            │
            ├─ Do tests pass?
            │    └─ NO → STOP: Fix the code
            │
            ├─ Did you add new exports or parameters?
            │    └─ YES → STOP: Go back to Red phase
            │
            └─ Are there untested code paths?
                 └─ YES → STOP: Write more tests
```

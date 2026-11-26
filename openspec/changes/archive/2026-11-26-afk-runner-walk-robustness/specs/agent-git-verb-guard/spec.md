# agent-git-verb-guard Specification — Delta

## ADDED Requirements

### Requirement: Agent bash git verbs are blocklisted beyond stash and discard

The bash pre-hook SHALL block spawned-agent bash commands that invoke
history- or structure-mutating git verbs: `git reset` in any form, `git rm`,
`git switch` in any form, `git checkout` in any form (subsuming the
discard-only check), and `git branch` in its creation form — a `git branch`
invocation whose first following token is a non-flag argument. Read-only and
destructive-only-to-the-branch listings and deletions SHALL remain allowed:
`git branch` with a leading flag (for example `--list`, `-a`, `-d`) is not
creation. Blocking SHALL be textual over the whole command string, in the
existing per-verb check-module style, and each refusal SHALL name the blocked
verb. The hook SHALL NOT govern the runner's own direct git invocations (they
do not cross the bash tool boundary).

Rationale anchor: C9 finding F-P4 — an implementer reset the branch to
baseline, created a branch, and deleted the change folder mid-walk; only
stash/discard were blocked.

#### Scenario: Reset is refused

- **WHEN** an agent bash command contains a `git reset` invocation
- **THEN** the hook refuses the command naming `git reset`, whatever the reset mode

#### Scenario: Branch creation is refused

- **WHEN** an agent bash command contains `git branch agent/issue-42`
- **THEN** the hook refuses the command naming branch creation

#### Scenario: Branch listing stays allowed

- **WHEN** an agent bash command's only `git branch` invocations carry a leading flag, such as `git branch --show-current` or `git branch -a`
- **THEN** the hook does not refuse the command on branch grounds

#### Scenario: Switch and checkout of a ref are refused

- **WHEN** an agent bash command contains `git switch <ref>` or `git checkout <ref>`
- **THEN** the hook refuses the command naming the verb — the discard-only scope is subsumed

#### Scenario: Runner-side git is unaffected

- **WHEN** the runner performs its own slice commit or stop-verb git call through its exec seam
- **THEN** no bash hook evaluates it — the guard's scope is the spawned-agent bash tool only

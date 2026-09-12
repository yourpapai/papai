## Purpose

Keeps the test suite's verdicts independent of the host it runs on: tests that assert behavior under an absent git identity must construct that absence hermetically instead of relying on the host happening to have no identity configured.

## ADDED Requirements

### Requirement: Absence of a git identity is enforced, not assumed
The review-loop git-identity suite, on its negative path (a commit attempted with no identity applied), SHALL reach the identityless state hermetically so the commit fails on every host: git's automatic identity detection SHALL be disabled for that commit, and the commit environment SHALL be isolated from host-level git configuration and OS account data — an inherited home directory, a global or system gitconfig, or passwd-database fallback — so that none of them can supply an identity. The positive path SHALL remain unchanged: applying a configured identity stamps the author and committer environment variables and the commit then succeeds with that identity on both.

#### Scenario: Host with a configured global identity
- **WHEN** the suite runs on a host whose git has a global user.name/user.email configured
- **THEN** the negative-path commit still fails and the suite passes

#### Scenario: Host where git can auto-detect an identity
- **WHEN** the suite runs on a host with no configured identity where git would otherwise auto-detect one from the OS username and hostname
- **THEN** the negative-path commit still fails and the suite passes

#### Scenario: CI reproduction passes
- **WHEN** the suite runs with `CI=true` on a runner that has no git identity anywhere
- **THEN** both the negative-path and positive-path assertions hold

#### Scenario: Positive path is unchanged
- **WHEN** an identity is applied to the commit environment
- **THEN** the subsequent commit succeeds and records that identity as both author and committer

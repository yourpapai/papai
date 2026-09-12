## ADDED Requirements

### Requirement: The write guard fails closed

The guard SHALL NOT report "allow" because it was unable to analyse the content it was given. When
comment extraction cannot be performed accurately — the content does not parse, or the parser
reports any error — the guard SHALL fall back to a lexical scan of the raw text rather than treat
an empty or partial comment list as evidence that no suppression was added.

Where the guard compares content before and after an edit, both sides SHALL be analysed by the same
strategy, so that a difference in analysis method can never be mistaken for an added suppression.

A fault the guard cannot handle at all SHALL leave the tool call unblocked rather than crash it,
but SHALL NOT arise from ordinary unparseable content.

#### Scenario: An unparseable fragment carrying a directive is blocked

- **WHEN** an edit cannot be reconstructed against the file on disk, and its replacement text is a
  fragment that does not parse as a complete program — beginning mid-block, say — but contains a
  suppression directive in a comment
- **THEN** the guard blocks the write and names the directive, rather than allowing it because the
  parser returned no comments for that fragment

#### Scenario: A missing analysis capability is not silently permissive

- **WHEN** the mechanism the guard uses to extract comments is unavailable or raises
- **THEN** the guard does not return "allow" on that basis; the covering tests fail loudly rather
  than passing vacuously against a guard that permits everything

#### Scenario: Before and after are compared like for like

- **WHEN** one side of an edit parses cleanly and the other does not
- **THEN** both sides are analysed by the same strategy, and the verdict reflects a real change in
  suppression count rather than a change in how the two sides were measured

### Requirement: Added suppressions are blocked, existing ones are not

The guard SHALL block a write, edit or multi-edit that increases the number of suppression
directives in a commentable source file, and SHALL allow one that leaves the count unchanged or
reduces it. A directive appearing in text that is not a comment — a string literal, for instance —
SHALL NOT count, whenever the content can be analysed accurately.

Files that cannot carry code comments SHALL be ignored entirely.

#### Scenario: Adding a suppression is blocked

- **WHEN** a write, an edit, or a multi-edit introduces a comment carrying a lint-disable or
  type-suppression directive into a source file
- **THEN** the guard blocks it, naming the file and the directive, and points at fixing the
  underlying issue

#### Scenario: Removing a suppression is allowed

- **WHEN** an edit replaces a region containing an existing suppression comment with text that does
  not contain one
- **THEN** the guard allows it

#### Scenario: A directive named in a string literal is not a suppression

- **WHEN** parseable content mentions a directive inside a string literal rather than a comment
- **THEN** the guard allows it

#### Scenario: A non-code file is ignored

- **WHEN** the target file cannot carry code comments, such as a Markdown document, even though its
  content names a directive
- **THEN** the guard allows it without analysing comments

### Requirement: The guard's own tests run in CI

The test lane covering the write-time hook checks SHALL be executed by the repository's CI checks.
It SHALL be invoked by an explicit path, because the directory is invisible to the test runner's
default discovery.

#### Scenario: A regression in the guard turns CI red

- **WHEN** a change breaks a write-time hook check
- **THEN** the CI checks fail and name the failing hook test, rather than passing because the lane
  was never executed

#### Scenario: A dependency upgrade that removes an API used by a hook is caught

- **WHEN** an upgrade removes an API a hook check depends on
- **THEN** the hook lane fails in CI on the upgrade's own pull request, rather than after the
  upgrade has merged

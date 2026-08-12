## Purpose

Shared terminal-rendering primitives — an in-place ANSI block-redraw engine, the writable-stream contract it targets, and a small set of display-format helpers — consumed byte-identically by the `review-loop`, `mutation-improve`, and `sdd-runner` developer-tooling workspaces.

## ADDED Requirements

### Requirement: Duration formatting

The shared module SHALL expose a duration formatter that converts a non-negative millisecond count into a compact human-readable string. Counts under one minute SHALL render as `<seconds>s`; counts of one minute or more SHALL render as `<minutes>m<ss>s` with the seconds zero-padded to two digits. Negative inputs SHALL be treated as zero.

#### Scenario: Sub-minute durations render as seconds

- **WHEN** the duration formatter is given `0`
- **THEN** it SHALL return `0s`
- **WHEN** the duration formatter is given `42000`
- **THEN** it SHALL return `42s`

#### Scenario: Minute-and-second durations render padded

- **WHEN** the duration formatter is given `125000`
- **THEN** it SHALL return `2m05s`
- **WHEN** the duration formatter is given `60000` (exactly the minute boundary)
- **THEN** it SHALL return `1m00s`

#### Scenario: Negative input is clamped to zero

- **WHEN** the duration formatter is given a negative number
- **THEN** it SHALL return `0s`

### Requirement: Width-bounded truncation

The shared module SHALL expose a string truncator that fits a value into a maximum column budget. A non-positive budget SHALL yield the empty string. A value whose length does not exceed the budget SHALL be returned unchanged. A value longer than the budget SHALL be shortened to `budget - 1` characters and terminated with a single ellipsis character (U+2026), so the result is exactly `budget` characters wide.

#### Scenario: Non-positive budget yields empty string

- **WHEN** the truncator is given a value with a budget of `0`
- **THEN** it SHALL return the empty string
- **WHEN** the truncator is given a value with a negative budget
- **THEN** it SHALL return the empty string

#### Scenario: Value within budget is returned unchanged

- **WHEN** the truncator is given `abcd` with a budget of `4`
- **THEN** it SHALL return `abcd` unchanged

#### Scenario: Over-length value is shortened with an ellipsis

- **WHEN** the truncator is given a 26-character string with a budget of `10`
- **THEN** it SHALL return exactly 10 characters: the first 9 characters of the value followed by the ellipsis character (U+2026)

### Requirement: Token-count compaction

The shared module SHALL expose a token-count formatter that compacts large integers into a short readable form. Counts below one thousand SHALL render verbatim as integers. Counts from one thousand up to (but not including) one million SHALL render as `<n.n>k` with one digit after the decimal point. Counts of one million or more SHALL render as `<n.nn>M` with two digits after the decimal point.

#### Scenario: Small counts render verbatim

- **WHEN** the token-count formatter is given `999`
- **THEN** it SHALL return `999`

#### Scenario: Thousands render with a single-decimal k suffix

- **WHEN** the token-count formatter is given `1000`
- **THEN** it SHALL return `1.0k`
- **WHEN** the token-count formatter is given `9824`
- **THEN** it SHALL return `9.8k`
- **WHEN** the token-count formatter is given `228819`
- **THEN** it SHALL return `228.8k`

#### Scenario: Millions render with a two-decimal M suffix

- **WHEN** the token-count formatter is given `1000000`
- **THEN** it SHALL return `1.00M`
- **WHEN** the token-count formatter is given `1500000`
- **THEN** it SHALL return `1.50M`

### Requirement: Separator glyph

The shared module SHALL expose the middle-dot character (U+00B7) as a named separator constant, so that consumers composing status lines join their segments with a single, shared, consistent separator byte sequence.

#### Scenario: Consumers share one separator glyph

- **WHEN** any consumer composes a multi-segment status line
- **THEN** the segments SHALL be joined by the U+00B7 middle-dot character

### Requirement: Renderer stream contract

The shared module SHALL define a renderer-stream contract that any in-place renderer draws onto. A stream SHALL provide a `write(chunk)` operation accepting a string and returning a boolean success indicator. A stream MAY advertise an `isTTY` flag; when absent or not strictly true, the stream SHALL be treated as a non-interactive (pipe/file) sink. A stream MAY advertise a `columns` width; when absent, renderers fitting lines to width SHALL assume a default of `80` columns.

#### Scenario: Absent isTTY is treated as non-interactive

- **WHEN** a renderer is constructed over a stream that does not set `isTTY` to `true`
- **THEN** the renderer SHALL operate in its non-interactive (append-only, scrolling) mode

#### Scenario: Absent columns defaults to 80

- **WHEN** a renderer fits a line to width over a stream that does not advertise `columns`
- **THEN** the line SHALL be fitted to a budget of `80` columns

### Requirement: In-place block redraw

The shared module SHALL provide an in-place block-redraw capability that re-renders a contiguous region of terminal lines in place rather than scrolling. A redraw SHALL begin with a carriage return, move the cursor up by the number of lines previously rendered (minus one) when more than one line was previously rendered, erase each line with the ANSI erase-line sequence (`ESC [ 2 K`) before writing its content, and join successive lines with a newline followed by the erase-line sequence. No trailing newline SHALL be emitted after the final line. Each line SHALL be fitted to the stream's column budget before writing.

#### Scenario: First render of a single line

- **WHEN** the block engine renders a single line onto an empty block over an interactive stream
- **THEN** it SHALL emit a carriage return, one erase-line sequence, and the (fitted) line content, with no cursor-up and no trailing newline

#### Scenario: Re-render after the block has grown moves the cursor to the top

- **WHEN** a block already holds several rendered lines and is re-rendered with a larger or equal set of lines
- **THEN** the engine SHALL emit a carriage return followed by a cursor-up sequence moving up by the previously-rendered-line count minus one, then erase-and-write each line in turn

#### Scenario: Shrinking the block erases leftover lines below

- **WHEN** a new block contains fewer lines than the previously-rendered block
- **THEN** the engine SHALL, after writing the new lines, emit one additional `newline` plus `erase-line` for each leftover (removed) line, then move the cursor back up by the leftover count, leaving the cursor on the new block bottom

#### Scenario: Each rendered line is fitted to the stream width

- **WHEN** a rendered line is longer than the stream's column budget
- **THEN** the engine SHALL truncate that line (per the width-bounded truncation requirement) before writing it, so no rendered line exceeds the column budget

### Requirement: Clearing the rendered block

The shared module SHALL provide a way to clear (remove from the screen) the currently rendered block. Clearing SHALL begin with a carriage return, move the cursor up by the rendered-line count minus one when more than one line was rendered (reaching the region's top), then for each rendered line emit the ANSI erase-line sequence (`ESC [ 2 K`) followed by the ANSI cursor-down sequence (`ESC [ 1 B`) when it is not the last rendered line — joining successive erased lines with cursor-down rather than newline so the clear does not scroll the terminal. After erasing, the cursor SHALL return to the region's top via a cursor-up sequence moving up by the rendered-line count minus one when more than one line was rendered, and the tracked rendered-line count SHALL reset to zero. Clearing SHALL be a no-op that writes nothing when no lines are currently rendered.

#### Scenario: Clearing an active block erases every rendered line

- **WHEN** the block engine clears a block that currently renders several lines
- **THEN** it SHALL emit a carriage return, move the cursor up by the rendered-line count minus one, erase each rendered line in turn joined by the cursor-down sequence (`ESC [ 1 B`) rather than newline, and return the cursor to the top via cursor-up — and the tracked rendered-line count SHALL become zero

#### Scenario: Clearing an empty block writes nothing

- **WHEN** the block engine clears a block when no lines are currently rendered
- **THEN** it SHALL emit nothing

### Requirement: Stream-failure degradation

The shared module's renderers SHALL treat a `write` call that throws as a non-fatal stream failure. On such a failure the renderer SHALL mark itself as broken, SHALL NOT propagate the exception to its caller, SHALL disable interactive (dynamic) rendering from that point onward, and SHALL make all subsequent rendering operations into silent no-ops. This guarantees that a broken pipe (for example, `EPIPE` when output is closed mid-run) never crashes the host tool.

#### Scenario: A throwing write breaks the renderer without rethrowing

- **WHEN** a renderer's stream throws on `write` during a rendering call
- **THEN** the call SHALL return without propagating the exception, the renderer's dynamic mode SHALL become disabled, and no later rendering call SHALL throw or write anything

#### Scenario: Dynamic mode reports false once broken

- **WHEN** a renderer has been broken by a stream failure
- **THEN** its dynamic-mode indicator SHALL report `false` for all subsequent reads

### Requirement: Consolidation is byte-identical across consumers

The shared primitives SHALL, once consolidated, produce terminal output that is byte-identical to the output the three consuming workspaces (`review-loop`, `mutation-improve`, `sdd-runner`) produced from their pre-consolidation copies (the original `review-loop` primitives, the re-inlined copies in `sdd-runner`, and the relative-path imports in `mutation-improve`). This is the compatibility contract that makes the consolidation a pure refactor: no consumer's observable terminal output, status-line composition, slot semantics, verbosity/altitude filtering, or formatting SHALL change as a result of sourcing the primitives from the shared module.

#### Scenario: Existing consumer tests stay green byte-for-byte

- **WHEN** the consolidated primitives replace the per-workspace copies and relative-path imports
- **THEN** the existing renderer and format suites under `tests/review-loop/`, `tests/sdd-runner/`, and `tests/mutation-improve/` SHALL pass without alteration, asserting the exact same ANSI byte sequences and formatted strings as before consolidation

#### Scenario: The shared module is the single source of the primitives

- **WHEN** any of the three consumers needs the block-redraw engine, the stream contract, or the duration/truncate/token-count/middle-dot helpers
- **THEN** it SHALL source them from the shared workspace as a real workspace dependency, and SHALL NOT retain an inlined duplicate or a relative-path cross-workspace import

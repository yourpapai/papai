# sdd-runner-tui-presentation spec

## Purpose

Defines the shared presentation contract for sdd-runner's interactive screens — semantic color coding, framed aligned panels, resize-safe reflow, key-hints footer, help overlay, and the append-only/live render split — while holding decision, key, and non-TTY byte semantics invariant.

## ADDED Requirements

### Requirement: Semantic color coding

Every interactive sdd-runner screen (running, gate, and session screens alike) SHALL color-code its semantic markers through one shared scheme: finding severity (blocker, material, nitpick), pipeline stage status (pending, active, done, skipped), cost state (known, estimated, unknown), and agent retry badges. The same semantic value SHALL receive the same visual treatment on every screen that shows it, and color SHALL be decoration only — the marker's textual content SHALL remain present unchanged.

#### Scenario: Severity classes are visually distinct and consistent

- **WHEN** findings of more than one severity render on any interactive screen
- **THEN** each severity carries a distinct visual treatment, and the treatment for a given severity is identical on every screen that renders it

#### Scenario: Cost states are visually distinct

- **WHEN** costs in the known, estimated, and unknown states render on any interactive screen
- **THEN** each state is visually distinguishable from the others on that screen

#### Scenario: Retrying agents carry a retry badge

- **WHEN** an agent slot is retrying on the running screen
- **THEN** its line displays a retry badge that a first-attempt slot does not carry

### Requirement: Framed, aligned panels

Content regions on every interactive screen SHALL render as visually delimited panels sharing one frame style across screens, and columnar content SHALL align by visible display width so wide characters and emoji never break column alignment. Content that exceeds the available columns SHALL be truncated by visible width rather than overflowing or distorting the layout.

#### Scenario: Wide characters never break alignment

- **WHEN** panel labels contain wide characters or emoji that exceed the available columns
- **THEN** columns remain aligned by visible display width and no rendered line overflows the terminal width

#### Scenario: Panels share one frame style

- **WHEN** panels render on different interactive screens
- **THEN** every panel is delimited by the same frame style, so a panel is recognizable as such on any screen

### Requirement: Resize-safe reflow

Interactive screens SHALL track terminal width changes during a live session and reflow without restart: panels arranged side-by-side at or above the join threshold SHALL stack into a single column below it, and stacked panels SHALL rejoin when width rises again. A reflow SHALL NOT lose screen state — in-progress text-input buffers, cursor and selection position, and key handling SHALL continue across the resize — and after a reflow no rendered line SHALL exceed the current terminal width.

#### Scenario: Narrowing mid-session stacks panels

- **WHEN** the terminal narrows below the join threshold while a screen is live
- **THEN** panels re-stack into a single column without a restart and no line exceeds the new width

#### Scenario: Widening rejoins panels

- **WHEN** the terminal width rises back above the join threshold
- **THEN** panels return to their side-by-side arrangement

#### Scenario: Text entry survives a resize

- **WHEN** the terminal is resized while text is being entered into any in-view input (veto redirect, blocker answer, creation-form field)
- **THEN** the entered text and cursor position are preserved and further typing continues into the same buffer

### Requirement: Key-hints footer

Every interactive screen SHALL display a persistent footer listing that screen's currently active key affordances. The footer SHALL list only keys that are active on the current screen, and its presence SHALL NOT change any key's behavior.

#### Scenario: Footer is present on every screen

- **WHEN** any interactive sdd-runner screen is displayed
- **THEN** a footer listing that screen's keys is visible at all times

#### Scenario: Footer lists the current screen's keys

- **WHEN** the gate screen and the session screen are displayed in turn
- **THEN** each screen's footer lists its own keys and not the other screen's

### Requirement: Help overlay

Every interactive screen with its own key bindings SHALL offer a help overlay, toggled by `?`, listing that screen's keys with their meanings. The any-key ack shell is exempt — its single any-key binding is its whole contract, so `?` acks like any other key instead of opening the overlay. The session screen's delete-confirmation sub-screen carries the same exemption: its contract is `y` deletes and any other key cancels, so `?` cancels like any other key. The session screen's creation-form sub-screen is exempt from the toggle because it is permanently a text-entry context — `?` is always inserted as literal input text there and never opens the overlay, while its bindings remain listed in the footer. Opening and dismissing the overlay SHALL NOT alter run or screen state, and while the overlay is open, keys other than the dismiss keys SHALL NOT trigger decisions, navigation, or stop actions. In text-entry contexts (veto redirect, blocker answer, creation-form fields) `?` SHALL be inserted as literal input text and SHALL NOT open the overlay.

#### Scenario: Overlay opens and dismisses without side effects

- **WHEN** `?` is pressed on a screen and the overlay is then dismissed
- **THEN** the overlay listed that screen's keys and meanings, and the screen is restored exactly as it was, with no run or screen state changed

#### Scenario: Help is safe while open

- **WHEN** arbitrary keys are pressed while the help overlay is open
- **THEN** no gate decision, stop request, session action, or other state change occurs

#### Scenario: Question mark is literal in text entry

- **WHEN** `?` is typed into any in-view text input
- **THEN** it becomes part of the entered text and no overlay opens

#### Scenario: Any-key surfaces keep their any-key contract

- **WHEN** `?` is pressed on the any-key ack shell or the session screen's delete-confirmation sub-screen
- **THEN** the key performs that surface's any-key action — ack, or cancel back to the list — and no overlay opens

### Requirement: Append-only and live render split

Each interactive screen that renders finalized history entries SHALL split its content into an append-only history region and a live region; screens whose content is entirely live (the gate's decision surfaces, the session list) render wholly in the live region. Completed history entries — per-round burndown rows, filed finding rows, completed agent rows, and other finalized rows — SHALL be emitted once and never redrawn or mutated by later frames, while live content (active agent slots, status line, pipeline map, decision surfaces) re-renders in place on each event. Emitted history rows SHALL retain their content and relative order regardless of later events.

#### Scenario: History rows are stable across later events

- **WHEN** events arrive after a burndown row, finding row, or completed-agent row was rendered
- **THEN** those rows' content and order are unchanged while the live region updates in place

#### Scenario: Live region keeps updating as history grows

- **WHEN** a run accumulates many review rounds and findings
- **THEN** the live region still updates on each new event

### Requirement: Monochrome degradation

When color is disabled (`NO_COLOR` set, or the terminal cannot render color), interactive screens SHALL remain structurally identical to the colored rendering — same panels, alignment, footer, and help overlay — with color styling omitted, and every distinction normally carried by color (severity, stage status, cost state, retry) SHALL remain distinguishable through non-color markers such as text labels and badges.

#### Scenario: NO_COLOR strips color but not structure

- **WHEN** `NO_COLOR` is set while a screen is displayed
- **THEN** panels, alignment, footer, and help overlay render as in color mode but the output contains no color escape sequences

#### Scenario: Distinctions survive without color

- **WHEN** the same screen content renders once with color enabled and once with color disabled
- **THEN** every semantic distinction (severity, stage status, cost state, retry) is identifiable in both renderings without relying on color

### Requirement: Presentation invariants

The presentation layer SHALL NOT alter decision semantics, key semantics, or the non-interactive byte contract. Identical key sequences SHALL produce identical decisions, gate files, and run-state outcomes regardless of presentation state (color mode, footer or overlay visibility, terminal width, panel arrangement), and non-TTY output SHALL remain byte-identical to the frozen pre-change contract with no presentation-layer styling in the stream.

#### Scenario: Decisions are independent of presentation state

- **WHEN** the same gate is answered through the same key sequence under different presentation states (color versus `NO_COLOR`, help opened earlier in the session, narrow versus wide terminal)
- **THEN** the resulting gate file and run state are identical

#### Scenario: Non-TTY output is untouched

- **WHEN** the runner renders to a non-TTY sink (pipe, file, CI log)
- **THEN** the byte stream contains no presentation-layer styling and matches the frozen non-TTY contract exactly

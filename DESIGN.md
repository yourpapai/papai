---
name: papai — Paper & Papaya
description: >
  Landing-page visual identity for papai, a self-hosted chat companion that
  turns natural-language messages into structured work inside a task tracker.
  The design pairs a sun-warmed paper surface with a single papaya accent and
  espresso-warm ink — a calm editorial page that reads like a magazine column,
  set on the side of a developer's desk.
colors:
  surface: '#faf6ef'
  surface-bright: '#ffffff'
  surface-container-low: '#f7f2e9'
  surface-container: '#efe8db'
  surface-container-high: '#e7dfce'
  ink: '#1f1a16'
  ink-soft: '#3a322b'
  ink-muted: '#6b6157'
  ink-faint: '#8c8175'
  ink-disabled: '#b6ad9f'
  primary: '#e36a2c'
  on-primary: '#3a1a07'
  primary-tint: '#fde8d8'
  primary-hover: '#f08856'
  primary-container: '#ffd9c2'
  on-primary-container: '#3a1a07'
  secondary: '#5f8a6a'
  secondary-tint: '#ecf3ee'
  secondary-container: '#d8eadd'
  on-secondary-container: '#1c3022'
  tertiary-container: '#fbe9b3'
  on-tertiary-container: '#3a2a04'
  success-container: '#d8eadd'
  on-success-container: '#1c3022'
  warning-container: '#fbe9b3'
  on-warning-container: '#3a2a04'
  error-container: '#fbe0d8'
  on-error-container: '#5a1a10'
  info-container: '#dde6ef'
  on-info-container: '#0e2640'
  inverse-surface: '#1c1814'
  inverse-surface-raised: '#26211c'
  inverse-on-surface: '#f1ebe0'
  inverse-on-surface-variant: '#a89d8d'
  inverse-primary: '#ff9a5c'
  chip-telegram: '#e7f1f8'
  on-chip-telegram: '#1f3a55'
  chip-mattermost: '#eef0fb'
  on-chip-mattermost: '#2b2f6a'
  chip-discord: '#ecedf9'
  on-chip-discord: '#3a3d80'
  chip-kaneo: '#eaf3ee'
  on-chip-kaneo: '#234734'
  chip-youtrack: '#fbeae5'
  on-chip-youtrack: '#5a2418'
typography:
  display-xl:
    fontFamily: Fraunces
    fontSize: 84px
    fontWeight: '500'
    lineHeight: 88px
    letterSpacing: '-0.03em'
  display-lg:
    fontFamily: Fraunces
    fontSize: 64px
    fontWeight: '500'
    lineHeight: 68px
    letterSpacing: '-0.025em'
  display-md:
    fontFamily: Fraunces
    fontSize: 48px
    fontWeight: '500'
    lineHeight: 54px
    letterSpacing: '-0.02em'
  headline-lg:
    fontFamily: Fraunces
    fontSize: 36px
    fontWeight: '500'
    lineHeight: 42px
    letterSpacing: '-0.015em'
  headline-md:
    fontFamily: Fraunces
    fontSize: 28px
    fontWeight: '500'
    lineHeight: 34px
    letterSpacing: '-0.01em'
  title-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: '-0.005em'
  title-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  title-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Inter
    fontSize: 19px
    fontWeight: '400'
    lineHeight: 30px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: '0.005em'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: '0.08em'
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  quote:
    fontFamily: Fraunces
    fontSize: 24px
    fontWeight: '400'
    lineHeight: 34px
    letterSpacing: '-0.005em'
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '450'
    lineHeight: 22px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '450'
    lineHeight: 18px
    letterSpacing: '0.01em'
  chat-message:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
rounded:
  none: 0px
  xs: 4px
  sm: 6px
  DEFAULT: 12px
  md: 12px
  lg: 20px
  xl: 28px
  2xl: 36px
  pill: 9999px
  full: 9999px
spacing:
  '0': 0px
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '10': 40px
  '12': 48px
  '16': 64px
  '20': 80px
  '24': 96px
  '32': 128px
  '40': 160px
components:
  page:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'

  nav-bar:
    backgroundColor: '{colors.surface-bright}'
    textColor: '{colors.ink}'
    height: 72px
    padding: 16px 32px

  nav-link:
    textColor: '{colors.ink-soft}'
    typography: '{typography.label-md}'
    rounded: '{rounded.sm}'
    padding: 8px 12px

  nav-link-hover:
    backgroundColor: '{colors.surface-container}'
    textColor: '{colors.ink}'
    typography: '{typography.label-md}'
    rounded: '{rounded.sm}'
    padding: 8px 12px

  nav-link-active:
    backgroundColor: '{colors.surface-container-high}'
    textColor: '{colors.ink}'
    typography: '{typography.label-md}'
    rounded: '{rounded.sm}'
    padding: 8px 12px

  nav-cta:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.surface-bright}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 10px 18px
    height: 40px

  hero-eyebrow:
    textColor: '{colors.primary}'
    typography: '{typography.label-sm}'

  hero-headline:
    textColor: '{colors.ink}'
    typography: '{typography.display-xl}'

  hero-subhead:
    textColor: '{colors.ink-muted}'
    typography: '{typography.body-lg}'

  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 14px 24px
    height: 48px

  button-primary-hover:
    backgroundColor: '{colors.primary-hover}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 14px 24px
    height: 48px

  button-primary-soft:
    backgroundColor: '{colors.primary-container}'
    textColor: '{colors.on-primary-container}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 12px 20px
    height: 44px

  button-secondary:
    backgroundColor: '{colors.surface-bright}'
    textColor: '{colors.ink}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 14px 22px
    height: 48px

  button-secondary-hover:
    backgroundColor: '{colors.surface-container-low}'
    textColor: '{colors.ink}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 14px 22px
    height: 48px

  button-secondary-soft:
    backgroundColor: '{colors.secondary-container}'
    textColor: '{colors.on-secondary-container}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 12px 20px
    height: 44px

  button-ghost:
    textColor: '{colors.ink-soft}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 12px 16px
    height: 44px

  button-ghost-hover:
    backgroundColor: '{colors.surface-container}'
    textColor: '{colors.ink}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 12px 16px
    height: 44px

  input-field:
    backgroundColor: '{colors.surface-bright}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 12px 16px
    height: 48px

  input-placeholder:
    textColor: '{colors.ink-faint}'
    typography: '{typography.body-md}'

  chat-mockup-card:
    backgroundColor: '{colors.surface-bright}'
    rounded: '{rounded.xl}'
    padding: 24px
    width: 480px

  chat-bubble-user:
    backgroundColor: '{colors.surface-container}'
    textColor: '{colors.ink}'
    typography: '{typography.chat-message}'
    rounded: '{rounded.lg}'
    padding: 12px 16px

  chat-bubble-bot:
    backgroundColor: '{colors.primary-tint}'
    textColor: '{colors.ink}'
    typography: '{typography.chat-message}'
    rounded: '{rounded.lg}'
    padding: 12px 16px

  chat-tool-pill:
    backgroundColor: '{colors.secondary-tint}'
    textColor: '{colors.on-secondary-container}'
    typography: '{typography.code-sm}'
    rounded: '{rounded.pill}'
    padding: 4px 10px

  chat-typing-dot:
    backgroundColor: '{colors.ink-faint}'
    rounded: '{rounded.full}'
    size: 6px

  provider-strip:
    backgroundColor: '{colors.surface-container-low}'
    padding: 40px 32px

  provider-chip:
    backgroundColor: '{colors.surface-bright}'
    textColor: '{colors.ink}'
    typography: '{typography.label-md}'
    rounded: '{rounded.pill}'
    padding: 10px 18px
    height: 40px

  provider-monogram-telegram:
    backgroundColor: '{colors.chip-telegram}'
    textColor: '{colors.on-chip-telegram}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.sm}'
    size: 28px
    padding: 4px

  provider-monogram-mattermost:
    backgroundColor: '{colors.chip-mattermost}'
    textColor: '{colors.on-chip-mattermost}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.sm}'
    size: 28px
    padding: 4px

  provider-monogram-discord:
    backgroundColor: '{colors.chip-discord}'
    textColor: '{colors.on-chip-discord}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.sm}'
    size: 28px
    padding: 4px

  provider-monogram-kaneo:
    backgroundColor: '{colors.chip-kaneo}'
    textColor: '{colors.on-chip-kaneo}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.sm}'
    size: 28px
    padding: 4px

  provider-monogram-youtrack:
    backgroundColor: '{colors.chip-youtrack}'
    textColor: '{colors.on-chip-youtrack}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.sm}'
    size: 28px
    padding: 4px

  feature-card:
    backgroundColor: '{colors.surface-bright}'
    textColor: '{colors.ink}'
    rounded: '{rounded.xl}'
    padding: 32px

  feature-card-hover:
    backgroundColor: '{colors.surface-container-low}'
    textColor: '{colors.ink}'
    rounded: '{rounded.xl}'
    padding: 32px

  feature-icon-tile:
    backgroundColor: '{colors.primary-tint}'
    textColor: '{colors.on-primary-container}'
    rounded: '{rounded.md}'
    size: 48px
    padding: 12px

  feature-icon-tile-sage:
    backgroundColor: '{colors.secondary-tint}'
    textColor: '{colors.on-secondary-container}'
    rounded: '{rounded.md}'
    size: 48px
    padding: 12px

  feature-icon-tile-corn:
    backgroundColor: '{colors.tertiary-container}'
    textColor: '{colors.on-tertiary-container}'
    rounded: '{rounded.md}'
    size: 48px
    padding: 12px

  feature-title:
    textColor: '{colors.ink}'
    typography: '{typography.title-md}'

  feature-body:
    textColor: '{colors.ink-muted}'
    typography: '{typography.body-md}'

  matrix-table:
    backgroundColor: '{colors.surface-bright}'
    rounded: '{rounded.xl}'

  matrix-cell:
    textColor: '{colors.ink-soft}'
    typography: '{typography.body-sm}'
    padding: 20px

  matrix-cell-header:
    backgroundColor: '{colors.surface-container-low}'
    textColor: '{colors.ink}'
    typography: '{typography.label-md}'
    padding: 20px

  matrix-check:
    textColor: '{colors.secondary}'
    typography: '{typography.body-sm}'

  matrix-dash:
    textColor: '{colors.ink-disabled}'
    typography: '{typography.body-sm}'

  install-block:
    backgroundColor: '{colors.inverse-surface}'
    textColor: '{colors.inverse-on-surface}'
    typography: '{typography.code-md}'
    rounded: '{rounded.lg}'
    padding: 24px

  install-prompt:
    textColor: '{colors.inverse-primary}'
    typography: '{typography.code-md}'

  install-copy-button:
    backgroundColor: '{colors.inverse-surface-raised}'
    textColor: '{colors.inverse-on-surface}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.sm}'
    padding: 6px 10px

  terminal-prompt:
    backgroundColor: '{colors.inverse-surface}'
    textColor: '{colors.inverse-primary}'
    typography: '{typography.code-md}'
    rounded: '{rounded.md}'
    padding: 16px

  testimonial-card:
    backgroundColor: '{colors.surface-bright}'
    textColor: '{colors.ink}'
    rounded: '{rounded.xl}'
    padding: 32px

  testimonial-quote:
    textColor: '{colors.ink}'
    typography: '{typography.quote}'

  testimonial-attribution:
    textColor: '{colors.ink-muted}'
    typography: '{typography.label-md}'

  stat-numeral:
    textColor: '{colors.primary}'
    typography: '{typography.display-lg}'

  stat-label:
    textColor: '{colors.ink-muted}'
    typography: '{typography.label-sm}'

  cta-band:
    backgroundColor: '{colors.tertiary-container}'
    textColor: '{colors.ink}'
    rounded: '{rounded.2xl}'
    padding: 64px

  cta-headline:
    textColor: '{colors.ink}'
    typography: '{typography.display-md}'

  alert-error:
    backgroundColor: '{colors.error-container}'
    textColor: '{colors.on-error-container}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: 12px 16px

  alert-warning:
    backgroundColor: '{colors.warning-container}'
    textColor: '{colors.on-warning-container}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: 12px 16px

  alert-info:
    backgroundColor: '{colors.info-container}'
    textColor: '{colors.on-info-container}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: 12px 16px

  alert-success:
    backgroundColor: '{colors.success-container}'
    textColor: '{colors.on-success-container}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: 12px 16px

  section-divider:
    backgroundColor: '{colors.surface-container}'
    height: 1px

  footer:
    backgroundColor: '{colors.inverse-surface}'
    textColor: '{colors.inverse-on-surface}'
    padding: 64px 32px

  footer-link:
    textColor: '{colors.inverse-on-surface-variant}'
    typography: '{typography.body-sm}'

  footer-link-hover:
    textColor: '{colors.inverse-on-surface}'
    typography: '{typography.body-sm}'

  footer-mark:
    textColor: '{colors.inverse-primary}'
    typography: '{typography.headline-md}'

  footer-stamp:
    textColor: '{colors.inverse-on-surface-variant}'
    typography: '{typography.code-sm}'
---

## Overview

**Paper & Papaya** is the visual identity for papai — a self-hosted task companion that lives inside the chat apps your team already uses. The product's job is to feel like a quietly competent helper: the kind of teammate who knows where every project lives, never forgets a follow-up, and answers in two warm sentences instead of ten polished ones. The landing page rehearses that same posture: capable but unhurried, technical but approachable, opinionated about defaults but generous about how you wire it up.

The aesthetic blends three references:

- **The notebook page.** A warm cream surface, espresso ink, generous leading, an occasional serif pull-quote — the rhythm of writing, not dashboard-building.
- **The sunlit kitchen.** The name _papai_ is "papa" in Portuguese; papaya is the namesake fruit and the page's one moment of saturated color, lit from above by an aurora gradient.
- **The chat transcript.** Compact bubbles, a conspicuous sage tool-call pill, gentle typing motion. The product _is_ a conversation, so the marketing surface rehearses the product's own shape.

The voice is plainspoken and slightly Brazilian-sunny. Headlines are short. Copy never apologizes for being a bot. Code samples are not hidden behind tabs. The emotional register is _competent calm_ — papai does heavy work (routing intent, calling APIs, persisting state) and the page should feel like a piece of equipment that has been tuned, not sold.

## Colors

The palette is built around a 3-axis tension: **warm paper** for legibility and humanity, **espresso ink** for typographic gravity, **papaya** for the single thread of agency that runs through the page.

- **Surface family (`surface`, `surface-container-*`).** A sun-warmed cream (`#faf6ef` base), not paper-white. Five elevation tiers from `surface-bright` (`#ffffff`) to `surface-container-high` (`#e7dfce`) let cards, transcripts, and matrices stack without ever needing a hard divider. Each step is a low-contrast lift of roughly 4–6 luminance units — felt, not seen.
- **Ink ladder (`ink-*`).** A five-step warm espresso (`#1f1a16` → `#3a322b` → `#6b6157` → `#8c8175` → `#b6ad9f`) carries every text role from headline to disabled metadata without ever dropping into a cold gray. Pure black is reserved; using it would push the design toward sterile dashboard territory.
- **Papaya (`primary` `#e36a2c`).** The single saturated hue. Used for primary CTAs, focus rings, the eyebrow tag above the hero, the bot's chat bubble border, the install-block prompt, statistics, and the inline link color in long-form prose. Never use papaya for body copy or large filled regions — it is reserved for _moments of agency_.
- **Sage (`secondary` `#5f8a6a`).** A calm counter-accent: the "tool used" pill in the chat mockup, success ticks in the provider matrix, and inline indicators of system-side action. Sage and papaya are deliberately complementary without competing — one is a fruit, the other a leaf. Never on a CTA.
- **Corn-silk (`tertiary-container` `#fbe9b3`).** The rarest accent. Used only inside the final CTA band and as the third feature-icon-tile tint. Its scarcity is the point — it should always feel like a moment.
- **Semantic containers.** `success-container`, `warning-container`, `error-container`, `info-container` and their paired `on-*-container` ink colors appear only inside system bubbles, inline alerts, and matrix cells — never as decoration. The container pairs deliver WCAG AAA contrast at body sizes.
- **Inverse band (`inverse-surface` `#1c1814`).** A warm charcoal used for the install code block, terminal prompts, and the footer. Never pure black; it carries the same espresso temperature as the ink so dark sections feel like the same brand viewed at night.
- **Provider chips.** Telegram, Mattermost, Discord, Kaneo, YouTrack each receive a pale tint of the platform's house color paired with a deep `on-chip-*` ink. The tints are neutral monogram colors, not brand-accurate logos — enough signal to read instantly without crossing into trademark territory.
- **Contrast contract.** Ink-on-surface clears WCAG AAA at body sizes. On-primary (`#3a1a07` on `#e36a2c`) clears WCAG AA for button labels at 14 px / 600 weight — espresso-on-papaya, not white-on-papaya, gives the namesake button a more legible and more editorial feel. Muted variant text (`ink-muted` `#6b6157`) is held at AA for body and reserved for metadata. All container/on-container alert pairs clear AAA.

## Typography

Three typefaces, each doing one job:

- **Fraunces (display).** A contemporary serif with optical sizing and a touch of warmth. Carries every headline from the 84 px hero down to the 28 px section titles. Weights stay at 500; size does the work. Negative letter-spacing (-0.03em at the largest scale, easing to 0 at body) gives headlines a confident, magazine-like compression without crossing into "tech-bro condensed."
- **Inter (body, UI, labels).** The workhorse sans. Body copy at 16–19 px with 26–30 px line-height — closer to long-form reading than to UI density. Labels are caps-tracked.
- **JetBrains Mono (code).** Used exclusively for _evidence that the system thinks in code_: the install block, inline shell snippets, the tool-call pill, the footer build stamp. Set at a slightly higher weight (450) than its default to compensate for ink-on-cream contrast.

Hierarchy rules:

- **One display per screen.** An 84 px `display-xl` headline appears only on the hero; every other section opens with `headline-lg` (36 px) at most.
- **Generous leading.** Body line-height is 30 px for 19 px copy and 26 px for 16 px copy — closer to long-form reading than to UI density.
- **Labels are caps-tracked.** `label-sm` uses 0.08em letter-spacing in uppercase for eyebrow tags and section indices ("01 / OVERVIEW"); never used for actionable buttons.
- **Exactly one italic in the system.** The pull-quote in the testimonial section, set in Fraunces at 24 px and rendered italic by the implementation. Italics is reserved for the serif quote face; never used for emphasis in body copy. Use weight (500 → 600) or inline papaya color instead.

## Layout

The page is a **12-column desktop grid (1240 px max, 24 px gutters)**, collapsing to 8-column tablet and 4-column mobile (16 px gutters). The page reads as a vertical column of _acts_ rather than a tiled marketing matrix.

- **Section rhythm.** 96 px vertical spacing between sections on desktop (160 px around the hero and the final CTA), 80 px on tablet, 64 px on mobile. Inside a section, content blocks use the 4 px base scale.
- **Hero asymmetry.** Hero copy occupies columns 1–7 (a `1.05fr / 0.95fr` split on desktop). The chat-mockup exhibit sits in columns 8–12, _vertically off-axis_ — its top edge sits one baseline below the headline cap to avoid the rigid hero-screenshot lockup common in SaaS pages. On viewports below 1024 px the grid collapses to a single column with the mockup beneath the headline, never above it — the headline always opens the page.
- **Anchored navigation.** A 72 px sticky nav with a 14 px backdrop blur over a translucent cream and a hairline bottom border. The wordmark sits left in Fraunces, three to four `nav-link` items in muted ink, a single dark-pill `nav-cta` on the right.
- **Content widths.** Long-form prose blocks (the manifesto / "how it thinks" section) cap at **64 ch** for measure; chat transcript exhibits cap at **480 px** to mimic a real phone-width thread.
- **Footer as colophon.** Four-column footer (`1.4fr repeat(3, 1fr)`) on espresso `inverse-surface`, with a single-line monospaced build stamp on the last line aligned right — version, commit hash, build date — the same restraint as a well-typeset book's copyright page.

## Elevation & Depth

Depth is conveyed by **soft warm light, not hard shadow**. Because the canvas is cream, every shadow color should be a warm `rgba(31, 26, 22, x)` rather than black, so cards never feel cut out of the page. The system layers four cues:

1. **Surface tier shift.** Cards rise by stepping up one or two `surface-container-*` tiers (or onto `surface-bright` `#ffffff`). This is the primary depth cue and should always be tried first.
2. **Hairline border.** Every elevated surface (levels 1–2) carries a `1px solid` warm-gray border so cards still hold their shape on low-contrast screens or in print.
3. **Warm-tinted shadow.** Levels 3–5 add a long, blurred shadow with espresso tone (`rgba(31, 26, 22, 0.10)` at level 4) that anchors the element without darkening the surrounding surface.
4. **Papaya glow, used once.** The hero's primary CTA — and only the primary CTA — carries a soft papaya glow (`0 0 0 6px rgba(227, 106, 44, 0.12), 0 18px 40px -10px rgba(227, 106, 44, 0.28)`). This is the page's single radiant element; reusing it dilutes its meaning.

Hover lifts are restrained: 2 px translate, 180 ms ease-out, shadow widening from rest to hover. Focus rings are always **4 px papaya at 18 % opacity**, never the browser default. The focused element also receives a `2px solid` papaya border. The hero uses a layered **radial-gradient aurora** — a papaya glow in the upper-left, a sage glow in the upper-right, both fading into cream — to give the top of the page a sense of dawn light without using a photograph.

## Shapes

The shape language is **soft-rectangular with a single pill exception**. Roundness is the page's friendliness dial; we keep it set high but disciplined:

- **Cards & matrices:** 28 px (`rounded.xl`) for feature cards, chat mockup, testimonial; 20 px (`rounded.lg`) for the install block; 12 px (`rounded.md`) for code blocks and inline tiles. Generous but not pillowy.
- **Buttons & inputs:** Buttons are **pill-shaped** (`9999px`) across all three variants (primary, secondary, ghost) so they read as one family. Inputs drop to 12 px so they read as recesses, not pills.
- **Chat bubbles:** 20 px on all corners — papai treats both speakers as equal, so the lopsided "tail" bubble convention is deliberately avoided. The bot bubble carries a 3 px papaya left-bar instead, marking the speaker without breaking the shape.
- **Chips:** `pill` for provider chips and the sage tool-call pill (the page's only fully round shapes — reserved to flag _runtime capability or live tool call_); 6 px for small inline tags so they read as _tags_, not pills.
- **Hero illustration.** If used, a single soft-edged abstract papaya-glyph monogram in papaya — geometric, not figurative. Never a 3D render, never a gradient orb.
- **Iconography.** Line icons at 1.5 px stroke, rounded caps and joins, 24 px grid. Outline only; filled icons read as alarms. Icon tiles inside feature cards are 48 px squares (12 px radius); the default tint is papaya, with sage and corn-silk variants for category differentiation.

## Motion

Motion is calm and largely on-scroll:

- **Reveal-up.** Sections fade and translate 16 px upward over 700 ms with ease-out. Triggered once per element via `IntersectionObserver`. Never repeats.
- **Hover.** Buttons and cards lift 2 px and gain one shadow level over 180 ms. Text links underline-grow from left to right.
- **Chat typing.** The three dots in the bot's bubble pulse opacity from 0.3 → 1.0 → 0.3 over 1400 ms with a staggered 200 ms offset. Used in the hero mockup only.
- **Caret blink.** The single blinking caret on the chat input line uses `1100ms steps(2, jump-none) infinite` so it ticks instead of fades — closer to a real terminal cursor.
- **Provider marquee.** The row of provider chips below the hero scrolls horizontally at a slow 40 s linear loop, paused on hover.
- **Reduced-motion.** All motion respects `prefers-reduced-motion: reduce` and falls back to opacity-only transitions of 120 ms. The marquee becomes a static row.

Easing curves: standard `cubic-bezier(0.2, 0, 0, 1)` for UI state changes, `cubic-bezier(0.22, 1, 0.36, 1)` for entrances and hovers, `cubic-bezier(0.34, 1.56, 0.64, 1)` reserved for a single use (the "Copied" toast on the install block).

## Components

### Navigation

A 72 px sticky bar with a 14 px backdrop blur over a translucent cream and a hairline bottom border. Contains the Fraunces wordmark, three to four `nav-link` items in `ink-soft`, a single `button-ghost` ("Docs"), and a dark-pill `nav-cta` ("Self-host"). On scroll past 80 px the bar's opacity ramps up over 240 ms; active links shift from `ink-soft` to `ink`.

### Hero

The hero stacks four elements on the left columns:

1. A `hero-eyebrow` chip — 12 px papaya caps, e.g. `01 — A CHAT BOT FOR PEOPLE WHO WRITE TICKETS`.
2. A `hero-headline` set in `display-xl` at 84 / 88 with -0.03em tracking. Two to three lines max; the last line may contain a single papaya inline word as the visual destination, capped at 14 ch.
3. A `hero-subhead` at `body-lg`, capped at 52 ch.
4. A `button-primary` + `button-secondary` row. The primary carries the page's only papaya glow.

To the right sits the **chat-mockup card** — a vertically stacked sequence of `chat-bubble-user` and `chat-bubble-bot` components interspersed with one `chat-tool-pill` (sage) and one `chat-typing-dot` line at the bottom. The transcript is static visually but should _feel_ mid-stream. The hero background is the aurora gradient.

### Chat Transcript Exhibit

This is papai's signature component and should appear at least twice on the page — once in the hero, once as a longer scripted scenario in the middle. It contains:

- `chat-bubble-user` — right-aligned, `surface-container` background, ink text. The human's message.
- `chat-bubble-bot` — left-aligned, `primary-tint` background, ink text, **3 px papaya left-bar**. The bot's reply.
- `chat-tool-pill` — small sage pill in `code-sm` showing the tool name and a redacted argument summary, e.g. `tool: create_task · project=inbox`. Anchored just above or inside the bot's reply.
- `terminal-prompt` may follow a transcript to show the same intent expressed as a CLI call, reinforcing the "natural language is the interface" argument.

### Provider Strip

A cream band (`surface-container-low`) holding the marquee of provider chips. Each `provider-chip` is a white pill with a hairline border, a small monogram tile in the platform's tint (`chip-telegram`, `chip-mattermost`, `chip-discord`, `chip-kaneo`, `chip-youtrack`) and the platform name in Inter 14 px. The marquee scrolls at 40 s linear; paused on hover; static under reduced-motion.

### Feature Cards

`feature-card` is the workhorse of the middle sections. 32 px padding, `surface-bright` background, 28 px radius, hairline border. Cards are arranged in 3-column grids (collapsing to 2 then 1) and use restraint: one 48 px icon tile, one `title-md`, one short `body-md` paragraph in `ink-muted`. Hover lifts 2 px and steps the background to `surface-container-low`. Icon tiles default to papaya tint; sage and corn-silk variants signal category differentiation.

### Integration Matrix

A rounded `matrix-table` mapping capability rows (DM, group, threads, file relay, recurring, deferred prompts, web fetch, memo search) against provider columns (Telegram, Mattermost, Discord, Kaneo, YouTrack). Cells use a sage `matrix-check`, a faint en-dash `matrix-dash` for absence, or a short note in `body-sm`. Headers sit on `surface-container-low`. The table is the only place on the page where dense data is welcome.

### Buttons

- `button-primary`: papaya fill (`#e36a2c`), espresso ink (`#3a1a07`), pill, 14 / 24 padding, 48 px tall. Hover lifts 2 px and warms toward `primary-hover`; focus adds the 4 px papaya ring; the hero-CTA instance also carries the papaya glow.
- `button-primary-soft`: `primary-container` fill, `on-primary-container` ink. Used where a softer agency mark is needed (inline CTAs in long-form prose, "Try the demo" rows).
- `button-secondary`: white fill, ink text, pill geometry. Used as the companion action.
- `button-secondary-soft`: sage-container fill, deep-sage ink. Used in the matrix and beside `chat-tool-pill` for related actions.
- `button-ghost`: transparent, `ink-soft` text, hover fills with `surface-container`. Used everywhere a tertiary action lives.

All variants share pill geometry so they read as one family across density.

### Inputs

`input-field` uses `surface-bright` with a `rounded.md` radius. On focus the border shifts to papaya and the field gains the papaya halo at 4 px / 18 %. Placeholder text uses `ink-faint` (rendered as the `input-placeholder` token). A single-line `code-sm` hint may slide in below at 180 ms.

### Install Block

A dark espresso card (`inverse-surface`) with `code-md` monospace, a leading `$` prompt in papaya (`install-prompt`), and a small `install-copy-button` on `inverse-surface-raised` in the upper-right that flashes "Copied" for 1.5 s on click using a single spring curve.

### Statistics

`stat-numeral` uses `display-lg` at 64 / 68 in papaya; `stat-label` sits below in 12 px caps-tracked `ink-muted`. Statistics appear in 3- or 4-up rows and are the only place outside CTAs where papaya appears at scale.

### Pull Quotes & Testimonial

`testimonial-card` and `quote` use **Fraunces** at 24 / 34, rendered italic. The attribution line below uses `label-md` `ink-muted` with a small avatar, a name, and a role. The italic serif marks "this is a person speaking" without needing quotation marks. Quote cards are wider (8 of 12 columns) and never include hero photography — the focus stays on language, not personality.

### Alerts

Four soft-tinted variants — `alert-error`, `alert-warning`, `alert-info`, `alert-success` — each carries its container tint and `body-sm` ink. Used inline in long-form prose and inside system chat bubbles. Never used for decoration.

### CTA Band

A nearly-rectangular 36 px-rounded card at the foot of the page on `tertiary-container` (corn-silk), a 48 px Fraunces headline (`display-md`), and the same primary/secondary button pair from the hero. The CTA band is the second appearance of the corn-silk family; its scarcity makes it land.

### Footer

A four-column layout on `inverse-surface`: brand mark and tagline (left), then "Product / Docs / Community" link columns. Footer wordmark in `inverse-primary` (`#ff9a5c`) so the namesake color reappears once at the bottom. The last footer line is a single `code-sm` build stamp aligned right — version, commit hash, build date — set in `inverse-on-surface-variant`. No social-media glyphs in primary color; if present, they are 1.5 px outline icons in muted paper.

## Do's and Don'ts

**Do**

- Reserve the papaya accent for moments of agency: primary CTAs, focus rings, the bot bubble's left-bar, the install-block prompt, statistics, the hero eyebrow. Reserve the glow for a single CTA.
- Use mono for anything the system _executes_ — tool names, command snippets, configuration keys, the build stamp.
- Treat surface elevation as the primary depth cue. Reach for shadow only after stepping the surface tier first; always tint shadow with espresso, never pure black.
- Allow paragraphs of long-form prose at 64 ch measure. The product is a writing surface; the landing page can be one too.
- Show real (or realistic) chat transcripts. The product's voice is its strongest asset; do not hide it behind abstract marketing illustrations.
- Honor `prefers-reduced-motion`. The marquee, typing dots, and reveal-up all fall back to opacity-only 120 ms transitions.

**Don't**

- Don't use pure white text or pure black ink. Cream `surface` (`#faf6ef`) and espresso `ink` (`#1f1a16`) are the brand temperatures everywhere.
- Don't apply papaya to body copy, large filled regions, or decorative gradients. It loses meaning the moment it stops marking action.
- Don't introduce a third accent hue beyond sage and corn-silk, and don't use sage or corn-silk on a CTA.
- Don't use cold-gray shadows on the cream canvas — they read as smudges. Use warm `rgba(31, 26, 22, x)` shadows plus hairline borders at low elevations.
- Don't lean on stock 3D illustrations, gradient orbs, or generative-AI render imagery. The brand is restrained editorial craft, not chrome.
- Don't break the chat transcript metaphor with mascots, emoji-as-decoration, or speech-bubble tails. The transcript is the product; render it the way the product would render it.
- Don't use italics for emphasis in body copy. The sole italic in the system is the Fraunces pull-quote. Use weight or inline papaya color instead.

# Atlas design system

Atlas does not borrow a component library. The interface is built on its own token layer:
one set of named values that every rule uses, with light and dark as equal citizens.

## Why tokens

Before this, the stylesheet carried 124 variables but **dark mode did nothing** — it set
`color-scheme: dark` and no colours, so the app stayed white. Rules also hardcoded colours
in 20 places. Tokens fix both: a rule never names a colour, so changing the theme changes
everything at once.

## The layers

```
tokens      named values — colour, space, radius, type, elevation, motion
components  rules built only from tokens
features    the app's own components, also built only from tokens
```

## Tokens

**Surfaces** (back to front): `--surface-0` page, `--surface-1` card, `--surface-2` raised,
`--surface-3` pressed, `--surface-inset` wells.

**Lines**: `--line-soft` separators, `--line` controls, `--line-strong` hover.

**Ink**: `--ink-1` primary, `--ink-2` secondary, `--ink-3` muted, `--ink-4` disabled.

**Semantic**: `--brand`, `--positive`, `--caution`, `--negative`, `--info`, each with a
`-soft` companion for backgrounds.

**Space**: a 4px base — `--space-1` 4px through `--space-8` 64px.

**Radius**: `--radius-xs` 4px, `-sm` 6, `-md` 10, `-lg` 14, `-xl` 20, `-pill` 999.

**Type**: `--text-xs` 11px through `--text-3xl` 28px, with `--leading-*` and `--weight-*`.

**Elevation**: `--shadow-1` resting through `--shadow-4` modal.

**Motion**: `--ease` and `--dur-fast` 120ms / `-mid` 220ms / `-slow` 380ms.

## Dark mode

The same tokens are redefined inside `prefers-color-scheme: dark`. Nothing is patched
per-rule, so a component cannot be half-themed. Verified by reading computed styles in a
real browser: page, card and header ink all change.

```
light  body #f6f7f9  ink #0f1720  card #ffffff  header #6b7787
dark   body #0d1117  ink #e9eef5  card #151b23  header #8593a3
```

## Accessibility

- Every interactive element has a visible focus ring (`--ring`), never `outline: none` alone.
- Every input has an `aria-label`; the suite asserts none has two.
- Motion is disabled under `prefers-reduced-motion`.
- Text meets contrast against its own surface in both themes, because both come from the
  same token pair.

## Components

`btn` (default, primary, ghost, sm, xs) · `input` (default, sm, expr) · `scorecard` ·
`section-h` · `chip` · `demotag` · `table.dense` · `emptystate` · `briefing` · `cmdk` ·
`netbanner` · `toast` · `navbtn` · plus 53 feature components ported from the original
stylesheet and re-expressed with tokens.

## Rules for new work

1. Never write a raw colour, radius, space or font size in a rule — use a token.
2. Never add a dark-mode override for a single component; add a token instead.
3. Any new component goes in the feature section and uses only tokens.
4. Run `npm run verify:design` before committing a style change.

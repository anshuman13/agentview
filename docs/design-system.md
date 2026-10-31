# Design system v2

Tokens live in web/src/styles/tokens.css (scales first, then roles); primitive styles live in
web/src/styles/components/*.css; React primitives live in web/src/ui (Button.tsx, Panel.tsx).
Features compose these and keep only layout in their own CSS. Components read role tokens
(`--type-*`, `--shape-*`, `--elev-*`, `--state-*`, colour roles), never raw scale values.

Sources: Elastic EUI for panels, empty prompts, density and colour roles; Material 3 for state
layers, elevation levels, the shape scale, type roles and touch targets.

## Principles

- Calm: warm near-black and warm greys, no borders where spacing does the job, hover only under
  `(hover: hover)`, short motion (`--dur`, 120ms).
- Content first: chrome is quiet grey; controls get louder only when they act or are selected.
- One accent: `--accent` marks interaction (focus, selection, links, the one primary action).
- Profile marks: Work blue (`--work`) and Personal magenta (`--personal`) are the only identity
  colours on tasks and lists. Status colours mark state, always next to text or an icon.
- Dense on desktop, roomy on touch: 28 and 36px controls with a pointer, 44px on coarse pointers.

## Foundations

### Type roles (Material 3 roles, our sizes)

| Role | Size | Weight | Line height | Use |
| --- | --- | --- | --- | --- |
| display | `--fs-6xl` 28px | 600 | `--lh-tight` | rare: onboarding, big numbers |
| headline | `--fs-4xl` 22px | 600 | `--lh-tight` | page title |
| title | `--fs-lg` 14px | 600 | `--lh-snug` | panel, section and empty titles |
| body | `--fs-md` 13px | 400 | `--lh` | text, rows |
| label | `--fs-sm` 12px | 500 | `--lh-tight` | buttons, chips, meta |

Tokens: `--type-{role}-size`, `--type-{role}-weight`, `--type-{role}-line`. Coarse pointers
raise the small steps (tokens.css media query); inputs stay at 16px so iOS does not zoom.

### Spacing (EUI density)

2px unit: `--sp-N` = N x 2px. Inside a control `--sp-2` to `--sp-6`; between controls `--sp-4`;
panel padding `--sp-8` (`--sp-2 --sp-6` for dense list panels); between sections `--sp-12`.

### Shape (Material 3 scale, fewer steps)

| Token | Value | Use |
| --- | --- | --- |
| `--shape-sm` | 4px | buttons, fields, menu items |
| `--shape-md` | 6px | icon buttons, chips |
| `--shape-lg` | 12px | panels, menus, sheets |
| `--shape-full` | pill | badges, avatars, empty-state icon |

### Elevation (Material 3 levels, EUI borders)

| Level | Token | Surface | Use |
| --- | --- | --- | --- |
| 0 | `--elev-0` none | `--bg` | page content |
| 1 | `--elev-1` 1px `--border` ring | `--surface` | panels, cards |
| 2 | `--elev-2` = `--shadow-sm` | `--raised` | sheets, dragged rows |
| 3 | `--elev-3` = `--shadow-lg` | `--raised` | menus, dialogs, popovers |

Level 1 is a hairline drawn with box-shadow, so it never shifts layout. Only 2 and 3 cast shadows.

### State layers (Material 3)

Interactive controls lay a tint of their own content colour (`currentColor`) over their fill:
hover `--state-hover` 8%, focus `--state-focus` 10% plus the 2px `--accent` ring, pressed
`--state-press` 12%. Each control sets `--fill`; buttons.css draws
`linear-gradient(color-mix(currentColor var(--state), transparent)), var(--fill)`. One rule
covers every variant, works on any fill, and shows pressed feedback on touch. Disabled is 50%
opacity with no layer.

## Colour roles (EUI semantic roles)

| Role | Token | Meaning |
| --- | --- | --- |
| surface | `--bg` | page content |
| surface-raised | `--raised` | menus, sheets, dialogs |
| on-surface | `--on-surface` = `--fg` | primary text and icons |
| muted | `--on-surface-muted` = `--fg-muted` | secondary text, idle icons |
| faint | `--on-surface-faint` = `--fg-faint` | placeholders, empty icons |
| accent | `--accent`, `--accent-text`, `--accent-fill`, `--accent-soft` | interaction only |
| danger | `--danger` = `--err` | failed, late, destructive |
| ok | `--ok` | done |
| work | `--work` | Work profile mark |
| personal | `--personal` | Personal profile mark |

Chrome behind content is `--surface` (one step darker than `--bg`). Soft tints are the role
colour at 14% (`--warn-soft`); selected is `--accent-soft`.

## Components

### Button
`<Button variant size icon>`; `.btn .btn-{variant} .btn-{size}`. Label type, `--shape-sm`.
Sizes: sm `--control-sm` padding `--sp-5`; md `--control-md` padding `--sp-6`; 44px on touch.

| Variant | Content | `--fill` | Border |
| --- | --- | --- | --- |
| primary | `--on-accent` | `--accent-fill` | same |
| secondary (default) | `--fg` | none | `--border-strong` |
| quiet | `--fg-muted`, `--fg` on hover | none | none |
| danger | `--danger` | `--danger` at 14% | none |

### IconButton
`<IconButton icon label size on>`; square, `--shape-md`, `--fg-muted`, `--fg` on hover, `.on`
is `--accent-text`. 28 / 36px, 44px on touch (Material 48dp target, sized to iOS 44pt).

### Chip
`<Chip on late size icon>`; `.chip.chip-btn`. Filters and quick picks (Material filter chip).
Height `--size-2xl`, padding `--sp-4`, label type, `--shape-md`. Quiet: `--fg-muted`, no fill.
On: `--fg` over `--accent-soft`. Late: `--danger`. Static `.chip` is a read-only tag.

### Field
Fill `--sunken`, border `--border` (`--accent` on focus), `--shape-sm`, padding `--sp-2 --sp-4`,
placeholder `--on-surface-faint`. Borderless only where the field is the page content.

### Menu
Elevation 3 on `--raised`, `--shape-lg`, padding `--sp-2`. Items 40px, padding 0 `--sp-6`, gap
`--sp-4`, body type, `--shape-sm`, state layers as buttons. Danger item last, in `--danger`.
`<Menu trigger onClose>` with `<MenuItem icon danger href>` and `<MenuSeparator>` (web/src/ui/Menu.tsx,
components/menus.css). Arrow keys, Home and End move, Esc closes and refocuses the trigger, a press
outside closes. Status: built; the task page menu uses it, cp-pop stays (it is a listbox).

### Row
Height `--row-h` 40px (`--touch` on coarse pointers), padding `--list-pad`. Leading check or
icon, title in body type one line with ellipsis, meta in label type `--meta-fg`, trailing
IconButton sm or Chip shown on hover. Hairline only between groups.

### Panel (EuiPanel)
`<Panel title action padding>`; `.ui-panel`. Elevation 1 on `--surface`, `--shape-lg`.
Padding md `--sp-8`, sm `--sp-2 --sp-6` for panels holding rows. Optional header: title role
on the left, an action (IconButton sm or Button quiet sm) on the right. No nested panels.

### Badge
Counts and short state. Pill, `--size-2xs` high, `--fs-2xs` 600. Neutral `--border-strong`;
quiet `--hover`; waiting `--warn`; running `--accent-fill` with a dot (EUI badge colours, kept
to state roles only).

### EmptyState (EuiEmptyPrompt)
`<EmptyState icon title hint action size>`; `.ui-empty`. Centred: icon in a 48px `--hover`
circle (40px at sm) in `--on-surface-muted`, title role, hint in body `--on-surface-muted`,
then at most one action. md for a whole view, sm inside a panel or report. The icon stays grey;
the accent is for the action.

### Section header
Label type, `--fg-muted`, padding `--sp-4 --list-pad`, optional count Badge quiet and a
trailing IconButton sm. Collapsible headers rotate a chevron; no fill, state layer on hover.

## Migration

Done: Summary uses Panel (filter card) and EmptyState (empty report). Next: replace `.as-empty`
and `.empty-state` with EmptyState, move the remaining menus (as-menu) to Menu, and
move feature chips (as-chip, mt-add, cp-chip, mcp-chip, ag-chip) to Chip.

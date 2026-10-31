# Design system

Basic controls share one look. Tokens live in web/src/styles/tokens.css; primitive styles live in
web/src/styles/components/*.css; React primitives live in web/src/ui/Button.tsx. Features compose
these and keep only layout in their own feature CSS.

## Principles

- Calm: grey chrome, no borders where spacing does the job, hover shows only under `(hover: hover)`.
- Content first: controls are quiet by default and get louder only when they act or are selected.
- One accent per screen: at most one primary button; the accent marks interaction, never decoration.
- Colour codes identity: Work is blue (`--work`), Personal is magenta (`--personal`). Status colours
  (`--err`, `--warn`, `--ok`) only mark state, always next to text or an icon.
- Phones: inputs render at 16px (`--fs-2xl`) so iOS does not zoom; on coarse pointers every control
  reaches `--touch` (44px), or `--touch-sm` (36px) for chips inside dense rows.
- Focus: every control shows a 2px `--accent` ring on `:focus-visible`.

## Sizes

| Token | Value | Use |
| --- | --- | --- |
| `--control-sm` | 28px | small buttons, icon buttons and chips |
| `--control-md` | 36px | default buttons and icon buttons |
| `--size-2xl` | 32px | default chip |
| `--touch` | 44px | coarse pointer minimum |
| `--radius-sm` / `--radius-md` | 4px / 6px | buttons / icon buttons and chips |

## Button

`<Button variant size icon>`; classes `.btn .btn-{variant} .btn-{size}`.

| Variant | Text | Fill | Border | Hover |
| --- | --- | --- | --- | --- |
| primary | `--on-accent` | `--accent-fill` | same | `--accent-hover` |
| secondary (default) | `--fg` | none | `--border-strong` | `--hover` |
| quiet | `--fg-muted` | none | none | `--fg`, `--hover` |
| danger | `--err` | `--err` at 14% | none | `--err` at 24% |

| Size | Height | Padding | Font |
| --- | --- | --- | --- |
| sm | `--control-sm` | `--sp-5` | `--fs-sm` |
| md (default) | `--control-md` | `--sp-6` | `--fs-md` |

Disabled is 50% opacity. Legacy `.btn.xs/.sm/.lg/.primary/.quiet/.danger` remain until migrated.

## IconButton

`<IconButton icon label size on small>`; classes `.icon-btn .icon-btn-{size}`. `label` sets
`aria-label` and the tooltip. Square, `--radius-md`, `--fg-muted`; hover `--fg` on `--hover`;
`.on` is `--accent-text`. Sizes as Button (28px, 36px; 44px on touch). Plain `.icon-btn` (24px)
stays for dense toolbars.

## Chip

`<Chip on late size icon>`; classes `.chip.chip-btn` plus `.on`, `.late`, `.chip-sm`. For filters,
due dates and quick picks. Use `chipClass()` when a wrapper (such as a date picker) owns the button.

| State | Text | Fill |
| --- | --- | --- |
| quiet (default) | `--fg-muted` | none, `--hover` on hover |
| on (selected) | `--fg` | `--accent-soft` |
| late | `--err` | none |

Height `--size-2xl` (sm: `--control-sm`), padding `--sp-4`, gap `--sp-3`, `--fs-sm`, `--radius-md`.
Static `.chip` without `.chip-btn` is a read-only tag (badges.css).

## Field

Input, select and textarea share one look (components/inputs.css).

| Part | Token |
| --- | --- |
| fill | `--sunken` |
| border | `--border`, `--accent` on focus |
| radius | `--radius-sm` |
| padding | `--sp-2` `--sp-4` |
| placeholder | `--fg-faint` |
| font | inherit; `--fs-2xl` on coarse pointers |

Use a borderless field (title, description) only where the field is the page content.

## Menu

A popover anchored to its trigger (an IconButton with `aria-haspopup="menu"` and `aria-expanded`).

| Part | Token |
| --- | --- |
| panel | `--raised`, 1px `--border-card`, radius 12px, `--shadow-lg`, padding `--sp-2` |
| item | min-height 40px, padding 0 `--sp-6`, gap `--sp-4`, `--fs-md`, `--radius-sm` |
| item hover | `--hover` |
| leading icon | small Icon, `--fg-muted` |
| danger item | `--err`, last in the list |

Items use `role="menuitem"`; Escape and an outside click close the menu.

## Row

A list row: leading, title, meta, trailing.

| Part | Token |
| --- | --- |
| height | `--row-h` (40px), `--touch` on coarse pointers |
| padding | `--list-pad` sides |
| leading | check or icon, `--icon` |
| title | `--row-title`, `--fg`, one line with ellipsis |
| meta | `--row-meta`, `--meta-fg` |
| trailing | IconButton sm or a Chip, shown on hover with `(hover: hover)` |
| separator | `--hairline` only between groups |

## Migration

TaskEditor is the reference screen. Next: as-chip, as-add, as-section-btn, mt-add, cp-chip,
mcp-chip, ag-chip, the feature icon buttons that resize `.icon-btn`, and the menus (as-tt-menu,
as-menu, cp-pop) into one Menu component.

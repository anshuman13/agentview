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

### Type roles (Apple iOS text styles)

Each role names an Apple text style. Desktop keeps dense sizes; coarse pointers use Apple's.

| Role | Apple style | Desktop | Touch | Weight |
| --- | --- | --- | --- | --- |
| large-title | Large Title | 34px | 34px | 700 |
| title | Title 2 | 22px | 22px | 700 |
| headline | Headline | 14px | 16px | 600 |
| body | Body | 13px | 16px | 400 |
| callout | Callout | 13px | 15px | 400 |
| subheadline (meta) | Subheadline | 12px | 14px | 400 |
| footnote | Footnote | 12px | 12px | 400 |
| caption | Caption 2 | 11px | 12px | 400 |
| label | Footnote, 500 | 12px | 12px | 500 |

Tokens: `--type-{role}-size`, `--type-{role}-weight`, `--type-{role}-line`; `--type-meta-*` is the
subheadline. The Apple scale is `--fs-large-title` 34, `--fs-title1` 28, `--fs-title2` 22,
`--fs-title3` 20, `--fs-headline` and `--fs-body` 17, `--fs-callout` 16, `--fs-subheadline` 15,
`--fs-footnote` 13, `--fs-caption` 12, `--fs-caption2` 11; the older `--fs-*` steps alias it.
Touch runs the text roles one step below Apple's sizes. Inputs stay at 16px so iOS does not zoom.

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

### Button (iOS button styles)
`<Button variant size icon>`; `.btn .btn-{variant} .btn-{size}`. Variants filled, tinted, gray, plain,
danger; sizes sm 28px and md 34px (capsule, `--radius-pill`), lg 50px (12px radius, 17px semibold).
On coarse pointers sm and md keep their look but get a 44px hit area (an `::after` layer).
Old names still work: primary is filled, secondary (default) is gray, quiet is plain.

| Variant | Label | `--fill` |
| --- | --- | --- |
| filled | `--on-accent` | `--accent-fill` |
| tinted | `--accent-text` | `--accent` at 15% |
| gray (default) | `--accent-text` | `--hover` (systemFill) |
| plain | `--accent-text` | none |
| danger | `--danger` | `--danger` at 14% |

### IconButton
`<IconButton icon label size on>`; square, `--shape-md`, `--fg-muted`, `--fg` on hover, `.on`
is `--accent-text`. 28 / 36px, 44px on touch (Material 48dp target, sized to iOS 44pt).

### Chip
`<Chip on late size icon href>`; `.chip.chip-btn`. Filters and quick picks (Material filter chip). With `href` (plus `target`, `rel`) it renders an `<a>` with the same classes, for chips that open a link.
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
outside closes. Status: built; every menu uses it. cp-pop stays (it is a listbox), and `.as-menu` is the drawer hamburger button, not a menu.

### Row
Height `--row-h` 40px (`--touch` on coarse pointers), padding `--list-pad`. Leading check or
icon, title in body type one line with ellipsis, meta in label type `--meta-fg`, trailing
IconButton sm or Chip shown on hover. Hairline only between groups.
`<Row leading title meta trailing lines href onClick>` (web/src/ui/Row.tsx, components/rows.css): 48px
minimum, title clamps to 1 or 2 lines, a hairline under each row starts at the title, state layers
as buttons, a button or (with href) a link. Status: built; the topic timeline in Meetings uses it.

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

### Grouped list (iOS inset grouped)
Overview cards (`.ov-follow`, `.mt-rows.ov-card`, Needs you) and Meetings day groups (`.mt-days`) are
inset grouped lists: page `--group-page` (grey #F2F2F7 in light, black in dark), card `--group-card`
(white in light, #1C1C1E in dark), `--shape-lg` radius, no border, rows 44px minimum with a hairline
inset to the text start. Section labels above cards are Footnote size, `--fg-muted`, sentence case.

### Section header
Label type, `--fg-muted`, padding `--sp-4 --list-pad`, optional count Badge quiet and a
trailing IconButton sm. Collapsible headers rotate a chevron; no fill, state layer on hover.
`<Section label count action open onToggle>` (web/src/ui/Section.tsx, components/sections.css); with
`onToggle` the header is a button with `aria-expanded`. Status: built; the Meetings day headers use it.

## Patterns

Rules for how content is laid out, on top of the components. A spec that touches Overview, a card or a
list must say which pattern it follows. Anything the hub generates for the UI follows these too.

### Report card (digest, brief, summary)
What the hub produced about a period: the day digest, the morning brief, the away digest, a meeting summary.
- The hub writes structured rows (a JSON `rows` field, or one object per line), never a pre-wrapped text block
  with URLs in it. The UI never renders `pre-wrap` text from the hub.
- The card header is a Section header: a short title ("Today in Slack"), then quiet count Badges per
  outcome ("1 sent", "9 skipped"), then the time in label type. Not a sentence with counts in it.
- The body is a Grouped list. One Row per thing: title is the person or the subject, meta is the chat and one
  short reason or status, trailing is a status Badge. The whole row opens the thing (the task page, the meeting)
  in the app; never a bare URL. An external link is one IconButton sm with the "open" icon, at most one per row.
- Groups that need no action from the user (skipped, done, dry run) are folded behind their count; groups that
  do (failed, waiting) are open. Something that already has its own card (an ask in the Reply queue) is a count
  that links to that card, not a second list.
- Folded shows the first 3 rows and a "Show all N" quiet Button. Open state is remembered per card id, never
  shared between two cards.
- A dismiss is an IconButton sm "close" in the header, scoped to that one card.

### Row density
How much a list row may carry. The eye should find the one thing to do without reading.
- One line of title, one line of meta. Draft or quoted text in a row is a 2-line clamp in meta type, not a
  separate box. The full text lives on the item's page.
- At most two visible actions per row: the primary (Button sm, the one accent if it is the page's primary
  action) and one IconButton sm "more" opening a Menu with the rest (Edit, Skip, History, Open thread).
  Destructive items go last in the Menu. A row never shows Edit as a button; editing happens on the page or
  inline after a tap on the text.
- Secondary content (history, a reason, earlier replies) is behind the Menu or on the page, not a per-row Fold.
- Batch actions ("Send all", "Copy list") go in the Section header as its one action, not as a band above
  the rows. Two batch actions become a Menu on the header.
- A Badge per row at most one, for state only (FAQ, Needs you, Failed). Badges are not labels for things the
  title already says.
- Jobs rows follow this: one badge (Running, Queued, Failed, Off), a Run now Button sm, and a More menu with Edit,
  Disable or Enable, Delete. No switch and no last-run line on the row.
- Tasks as built: a Tasks row is the title, a meta line (due, then Repeats, checklist count, up to 2 tags, High or
  Medium, none on done rows), the check as Done, a Needs you Badge on suggested tasks and one More Menu
  (Open, Snooze, Tomorrow, Move, Delete). The checklist is read and toggled on the task page.
- Meetings as built: a meeting row is the title with the profile dot, a meta line (time with the weekday beyond today,
  room, N people), at most one Badge (Live, Recorded) and one More Menu (Open calendar, Notes). No avatars, tile or
  count badges; a transcript hit replaces the meta as a 2-line clamp.

### Overview page
The day at a glance on a phone. Five blocks in a fixed order, nothing else on the page. Each block is a Section
header plus one Grouped list of Rows (Row density), at most 5 rows then "Show all N". A block with nothing in
it is not rendered; there is no block-level empty state except the page's own "Nothing today".
1. **Now**: only while a meeting runs or starts within 15 minutes: the Next card. Otherwise absent.
2. **Needs you**: one list of everything waiting on the user, once each: overdue and at-risk tasks, asks and
   promises to confirm, DMs, Slack bullets, actions from a meeting that ended in the last two hours (meta "Just
   ended · <meeting>"), and one count row each for asks older than the stale limit and wiki claims to review.
   Each row: one Badge at most, one primary Button sm, one More Menu. Header action: one batch action.
3. **Reply queue**: the Report card already built; unchanged, after Needs you.
4. **Today**: the ordered list of what to do next (meeting within two hours first, then flagged, then due
   tasks), the first three numbered. Each row: Done (or Prep) as the button, More Menu with Focus, Tomorrow,
   Snooze. The header carries one Menu: Plan my day (opens the Plan strip under the header), Copy standup, and
   from 16:00 Wrap up (the Shutdown row). The last row is "Goals · N · 1 at risk" opening the Goals page; the
   goal progress lines move there. No separate Meetings today section: meetings beyond two hours are on the
   Meetings page.
5. **Reports**: the newest report (morning brief before 11:00, day or away digest after 17:00, weekly review
   from Friday 14:00) open as its Report card; every other report of the day is one Row (title, time, first
   line) in a Reports list: job runs, the other briefs, Since last visit. A row opens the report's page.
6. **Later**: one Fold, closed by default: the Tomorrow card, stale tasks, follow-through, keep in touch.
Gone: the Context fold, the Slack summary row (the Summary page is in the nav), the standalone wiki-claims and
stale-asks rows, the Meetings today section, the goal lines above the brief.

### Status language
- Outcomes are nouns in sentence case: Sent, Failed, Skipped, Waiting, Edited. Counts as "1 sent", "2 failed".
- "Needs you" is the only phrase for work the user must do; use it as a Badge, not in prose.
- Reasons are under 6 words in meta: "someone else answered", "second ask in 3 days".
- Times are relative within today ("14:20"), a weekday beyond ("Tue"), from `clock` and `ago` in codex/time.

## Migration

Done: Summary uses Panel (filter card), every empty list or report uses EmptyState (the old
`.as-empty` and `.empty-state` styles are gone), and the menus use Menu. Chips are done: as-chip, cp-chip, mcp-chip and ag-chip use Chip, which takes `tone` (`work`, `personal`, `accent`) and `quiet` (dashed, faint). `mt-add` stays a form, since it is an input row, and uses Chip tokens (height, radius, accent-soft on focus).

As of 31 Oct 2026 the light and dark themes use Apple's iOS system colours: white or black page, #F2F2F7 or #1C1C1E for cards and chrome, systemBlue accent and work, systemPurple personal, and Apple's Increase Contrast hues for status text in light. Meeting and knowledge icons are neutral.

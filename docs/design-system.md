# Design system v2

Tokens live in web/src/styles/tokens.css (scales first, then roles); primitive styles live in
web/src/styles/components/*.css; React primitives live in web/src/ui (Button.tsx, Panel.tsx).
Features compose these and keep only layout in their own CSS. Components read role tokens
(`--type-*`, `--shape-*`, `--elev-*`, `--state-*`, colour roles), never raw scale values.

Sources: Elastic EUI for panels, empty prompts, density and colour roles; Material 3 for state
layers, elevation levels, the shape scale, type roles and touch targets.

## Principles

- Calm: warm near-black and warm greys, no borders where spacing does the job, hover only under
  `(hover: hover)`, short motion (`--dur`, 120ms; see Motion).
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
hover `--state-hover` 8%, focus `--state-focus` 10% plus the focus ring (see Tokens), pressed
`--state-press` 12%. Each control sets `--fill`; buttons.css draws
`linear-gradient(color-mix(currentColor var(--state), transparent)), var(--fill)`. One rule
covers every variant, works on any fill, and shows pressed feedback on touch. Disabled is 50%
opacity with no layer.

### Tokens

- `--focus-ring`: `2px solid --accent`, used as `outline: var(--focus-ring)`.
- `--focus-offset`: 1px outset. Buttons, IconButtons, Chips, fields, and the base.css fallback for other buttons and links.
- `--focus-offset-inset`: -2px. Rows, AskRows, menu items and section heads, which sit edge to edge and would clip an outset ring.

The ring shows on `:focus-visible` only, never on mouse focus. No primitive hard-codes a ring colour or width. /design shows each ring in a "focused" Story through the `.ds-focus` wrapper.

### Motion

- Durations come from `--dur-fast`, `--dur` and the `--pulse*` tokens.
- Every transition and animation is either inside `@media (prefers-reduced-motion: no-preference)` or covered by the global reduce override at the end of base.css, which sets `animation: none` and `transition: none` with `!important` on `*`, `*::before` and `*::after`. Do not weaken it (no `:not()` exceptions).
- `scroll-behavior: smooth` needs a `no-preference` wrapper.
- Information is never carried by motion alone: status dots, skeletons and spinners keep a static colour, icon or adjacent text.
- `styles/motion.test.ts` enforces the override and the smooth-scroll rule.

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

`/design` is the visual review of every primitive, in every state, at desktop and phone width. A new primitive in `web/src/ui` gets its story added in `web/src/design/Stories.tsx`. The URL carries the state: `/design?theme=light|dark&width=phone|desktop#<primitive>`, all three optional and unknown values ignored, for example `/design?theme=light&width=phone#chip`. A query theme is not saved as the app theme. Each Block has a link button that copies its URL. A Block's name lowercased is its anchor, so a new primitive's Block name is its anchor.

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
is `--accent-text`. 28 / 36px, 44px on touch (Material 48dp target, sized to iOS 44pt). 44px hit area at max-width 480px.

### Chip
`<Chip on late size icon href>`; `.chip.chip-btn`. Filters and quick picks (Material filter chip). With `href` (plus `target`, `rel`) it renders an `<a>` with the same classes, for chips that open a link.
Height `--size-2xl`, padding `--sp-4`, label type, `--shape-md`. Quiet: `--fg-muted`, no fill.
On: `--fg` over `--accent-soft`. Late: `--danger`. Static `.chip` is a read-only tag. 44px hit area at max-width 480px.

### Field
Fill `--sunken`, border `--border` (focus ring on keyboard focus only), `--shape-sm`, padding `--sp-2 --sp-4`,
placeholder `--on-surface-faint`. Borderless only where the field is the page content.

### Menu
Elevation 3 on `--raised`, `--shape-lg`, padding `--sp-2`. Items 40px, padding 0 `--sp-6`, gap
`--sp-4`, body type, `--shape-sm`, state layers as buttons. Danger item last, in `--danger`.
`<Menu trigger onClose>` with `<MenuItem icon danger href>` and `<MenuSeparator>` (web/src/ui/Menu.tsx,
components/menus.css). Arrow keys, Home and End move, typing a letter focuses the next item starting with it (repeats cycle, a multi-letter buffer resets after 700ms), Esc closes and refocuses the trigger, a press
outside closes. At max-width 480px the Menu is a bottom sheet portaled to the body (`--scrim` backdrop that closes it, 44px items, top radius `--radius-sheet`, `--safe-bottom` padding); the popover stays above 480px. Status: built; every menu uses it. cp-pop stays (it is a listbox), and `.as-menu` is the drawer hamburger button, not a menu.

### Row
Height `--row-h` 40px (`--touch` on coarse pointers), padding `--list-pad`. Leading check or
icon, title in body type one line with ellipsis, meta in label type `--meta-fg`, trailing
IconButton sm or Chip shown on hover. Hairline only between groups.
`<Row leading title meta trailing lines href onClick>` (web/src/ui/Row.tsx, components/rows.css): 48px
minimum, title clamps to 1 or 2 lines, a hairline under each row starts at the title, state layers
as buttons, a button, a link (with href) or a plain div that holds its own controls and passes its props on (`plain`). A button Row takes an optional `action` (one IconButton sm) beside it. `AskRow` (web/src/ui/AskRow.tsx) is a Row with up to two actions at the end (one primary item and a More menu), used for Show all and the overview ask rows. Status: built; the topic timeline and meeting actions in Meetings and the digest, brief and Prep cards use it.

Testing: Row, Section, Chip and AskRow are tested by rendering to static markup and asserting the root element, classes and each branch (plain, href, action) in `web/src/ui/Row.test.ts`, `longPress.test.ts` (the press timer), `Section.test.ts`, `Button.test.ts` and `AskRow.test.ts`. A new branch or class on one of them needs a case in its test. `web/src/app/pages.smoke.test.tsx` renders Overview, Tasks, Meetings and `/design` on an empty store; a new top-level page or list gets a case there. `web/src/design/a11y.test.tsx` checks the `/design` markup for accessible names and menu roles.

Accessibility: a Row that opens something (button or link) takes its name from title and meta, so both must be real text. An IconButton always has `label` (it becomes `aria-label` and `title`). Menu items are `role="menuitem"` inside `role="menu"`. `web/src/design/a11y.test.tsx` checks the `/design` markup, so a new story must pass it.

### Panel (EuiPanel)
`<Panel title action padding>`; `.ui-panel`. Elevation 1 on `--surface`, `--shape-lg`.
Padding md `--sp-8`, sm `--sp-2 --sp-6` for panels holding rows. Optional header: title role
on the left, an action (IconButton sm or Button quiet sm) on the right. No nested panels.

### Badge
`<Badge status label? reason? count?>` in `ui/Badge.tsx`; `.badge`. Pill, `--size-2xs` high, `--fs-2xs` 600, foreground `--bg`.
The visible text is the status word in sentence case, or "N word" with `count` ("2 failed"). No other text.
- Seven words (Status language): waiting `--warn`; sent and done `--ok`; failed and late `--err`; skipped `--hover` with `--fg-muted`; new `--accent-fill`.
- Labels: `label` replaces the word only for "Needs you" on waiting and "Live" on running.
- Reason: `reason` becomes `aria-label` and `title`, never visible text ("Overdue" and "Missed" render Late with that reason).
- Digits-only exception: count badges (tab bar, nav, Section count, group counts) stay a raw `.badge` with neutral, quiet, waiting or running tone and hold only digits.
- Running exception: running has no Status language word. It shows "Running" or "Live" in `--accent-fill` with a dot.
- One Badge per Row, trailing, never beside a second state badge. Counts such as "N to confirm" and filter labels are plain muted text.

### EmptyState (EuiEmptyPrompt)
`<EmptyState icon title hint action size>`; `.ui-empty`. Centred: icon in a 48px `--hover`
circle (40px at sm) in `--on-surface-muted`, title role, hint in body `--on-surface-muted`,
then at most one action. md for a whole view, sm inside a panel or report. The icon stays grey;
the accent is for the action.
Copy (Status language): the title is a sentence-case noun phrase with no trailing period ("No past meetings yet"), the hint is one short line with no period, and the one action is a Button sm directly under `.ui-empty`.
Status: built; used in `app/App.tsx`, `app/Unreachable.tsx`, `codex/Codex.tsx`, `codex/GoalsPage.tsx`, `codex/Overview.tsx`, `codex/PlanPreview.tsx`, `codex/Search.tsx`, `codex/TagPage.tsx`, `codex/jobs/JobPage.tsx`, `codex/jobs/Jobs.tsx`, `codex/meetings/Decisions.tsx`, `codex/meetings/Load.tsx`, `codex/meetings/MeetingList.tsx`, `codex/meetings/Person.tsx`, `codex/meetings/Review.tsx`, `codex/meetings/SeriesPage.tsx`, `codex/meetings/Week.tsx`, `codex/summary/Summary.tsx`, `codex/wiki/Feed.tsx`, `codex/wiki/ReviewMode.tsx`, `codex/wiki/WikiIndex.tsx`, `codex/wiki/WikiPage.tsx`, `ops/Deploy.tsx`, `ops/Findings.tsx`, `ops/GitHub.tsx`, `ops/McpStatus.tsx`, `sessions/AgentsPane.tsx`, `sessions/Sessions.tsx`, `workspace/BrowserPane.tsx`, `workspace/Explorer.tsx`.

### Grouped list (iOS inset grouped)
Overview cards (`.as-group`, Needs you), the Meetings list and Meetings day groups are
inset grouped lists: page `--group-page` (grey #F2F2F7 in light, black in dark), card `--group-card`
(white in light, #1C1C1E in dark), `--shape-lg` radius, no border, rows 44px minimum with a hairline
inset to the text start. The Codex task lists, Goals, Search, Jobs and Summary (`.ui-group`), the editor Links and the Meetings list (`.as-group` under `.mt-page`) use it. Section labels above cards are Footnote size, `--fg-muted`, sentence case. A grouped card whose rows sit in wrappers (Overview Today: `.ov-ask`, `.as-swipe`) draws the inset hairline on the wrapper at the row's text start (52px with a lead, else `--list-pad`), never on the row and never full width.

### Section header
A header that heads a list of rows shows its full row count as the quiet Badge (`count={sectionCount(n)}`), including rows behind "Show all N" or a cap, and omits it at 0. A header over a single card, form or free text shows none. Series counts only its repeated rows, the rest are context.

Label type, `--fg-muted`, padding `--sp-4 --list-pad`, optional count Badge quiet and a
trailing IconButton sm (a text Button sm plain is allowed too). 44px hit area at max-width 480px. Collapsible headers rotate a chevron; no fill, state layer on hover.
`<Section label count action open onToggle>` (web/src/ui/Section.tsx, components/sections.css); with
`onToggle` the header is a button with `aria-expanded`. At max-width 480px a header that heads a group in Tasks, Meetings or the Today block is sticky at the top of its scroll container, opaque `--bg`, `--z-raised`. Status: built; the Meetings day headers, the Codex page and tag page headers, the reply draft header, the Observe panes, the Deploy log, the MCP detail pane, every Fold, the report card and next-meeting card heads and the Week goals card use it.

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
The phone behaviours below are summarised in [Phone](features.md#phone).
- One line of title, one line of meta. Draft or quoted text in a row is a 2-line clamp in meta type, not a
  separate box. The full text lives on the item's page.
- At most two visible actions per row: the primary (Button sm, the one accent if it is the page's primary
  action) and one IconButton sm "more" opening a Menu with the rest (Edit, Skip, History, Open thread).
  Destructive items go last in the Menu. A row never shows Edit as a button; editing happens on the page or
  inline after a tap on the text.
- Every Row, Section action and Chip has a 44px touch target at max-width 480px and on coarse pointers (`--touch`). Rows are 48px on desktop and at least 44px on touch; IconButtons and Chips keep their painted size and get a hit-area layer.
- Swipe actions: a Row swipe that completes, snoozes, moves or deletes shows the one snack with Undo for 5 s (`showSnack` with an undo, never a bare write); only the latest swipe can be undone. A swipe action added to a Row ships with its Undo.
- Long press menu: phone widths only (max-width 480px), touch only. Holding a row 500ms with under 10px of movement
  gives a haptic tap and opens the row's More menu as the bottom sheet; the click after release is swallowed. Only rows
  that have a More menu take it, and the kebab stays as the visible action.
- Pull to refresh: phone widths only (max-width 900px), at the top of the scroll container, on Overview, Tasks and
  Meetings (Wiki and Jobs share the hook). The indicator is the floating `.as-ptr` spinner chip, not a Row. A pull
  starts after 10px of downward, mostly vertical movement and refreshes at 64px of finger travel; shorter settles
  back. No refresh on desktop.
- Edge swipe back: phone widths only (max-width 900px). A right swipe from within 20px of the left edge, at least 70px
  and mostly horizontal, closes the topmost open page or sheet like the Back button. It does nothing on a list, inside
  a Row swipe or on desktop. Off in the Android app (Tauri, Android 10 or later) where system gesture navigation handles
  the left edge.
- Keyboard inset: touch input at phone widths only (max-width 900px). `useKeyboardInset` writes the covered height of the
  visual viewport to `--kb-inset` on the root once it is at least 100px, so URL bar changes are ignored. The New task
  and date sheets pad their overlay by it and sit on top of the keyboard; the task page pads `.wk-scroll` and scrolls
  the focused title, notes or Reply draft field into view. Unset on desktop and with the keyboard closed.
- Secondary content (history, a reason, earlier replies) is behind the Menu or on the page, not a per-row Fold.
- Batch actions ("Send all", "Copy list") go in the Section header as its one action, not as a band above
  the rows. Two batch actions become a Menu on the header.
- A Badge per row at most one, for state only (Needs you, Failed, Needs review on a wiki page row, which has only a More menu with Open and Archive). Badges are not labels for things the
  title already says.
- Jobs rows follow this: one badge (Running, Queued, Failed, Off, set by `jobState`), a Run now Button sm, and a More menu with Edit,
  Disable or Enable, Delete. No switch and no last-run line on the row.
- On phones a list restores its scroll position when the user returns from an item page, keyed by route (list and profile filter), once per return. Tasks and Meetings.
- Tasks as built: a Tasks row is the title, a meta line (due, then Repeats, checklist count, up to 2 tags, High or
  Medium, none on done rows), the check as Done, a Needs you Badge on suggested tasks and one More Menu
  (Open, Snooze, Tomorrow, Move, Delete). The checklist is read and toggled on the task page.
- Meetings as built: a meeting row is the title with the profile dot, a meta line (time with the weekday beyond today,
  room, N people), at most one Badge (Live) and one More Menu (Open calendar, Notes). No avatars, tile or
  count badges; a transcript hit replaces the meta as a 2-line clamp.

### Overview page
The day at a glance on a phone. Five blocks in a fixed order, nothing else on the page. Each block is a Section
header plus one Grouped list of Rows (Row density), at most 5 rows then "Show all N". A block with nothing in
it is not rendered. When Now, Needs you, Reply queue and Today are all empty, the page shows one EmptyState md
(icon pass, "Nothing today") in the Today slot: the hint names the next day with a meeting or a task ("Next: <when> <title>",
or "Nothing planned. Add a task to start the day.") and one primary New task Button sm opens the add sheet. Reports and
Later still render below it.
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

### Migration status

Custom list-row and header classes still in web/src. Todo means no use has been migrated yet. Partial means the class is gone from some files but still used in the files named. Done means the class is gone from TSX and CSS. Keep means it stays, with the reason under Replace with. Files are relative to web/src.

| Class | Files | Replace with | Status |
| --- | --- | --- | --- |
| ag-head | - | Section header | Done |
| ag-list, ag-row | - | Row | Done |
| ag-steps-list | sessions/AgentsPane.tsx | keep: layout (step list inside one card) | Keep |
| as-ctx-list | - | Grouped list | Done |
| as-date-head, as-date-row, as-date-rows | codex/AddSheet.tsx | keep: layout (date picker form rows in a sheet) | Keep |
| as-dayline | - | Section header | Done |
| as-draft-head | - | Section header | Done |
| as-drop-line | codex/Codex.tsx | keep: layout (drag insertion marker) | Keep |
| as-flag-item | codex/AddSheet.tsx, codex/TaskEditor.tsx | keep: layout (toggle chip in a form) | Keep |
| as-head | - | Section header | Done |
| as-links-list | - | Grouped list | Done |
| as-list | - | Grouped list | Done |
| as-next-head | none | Report card | Done |
| as-row | codex/Task.tsx | Row | Done |
| as-swipe-row | codex/Swipe.tsx | keep: layout (swipe gesture container) | Keep |
| as-tt-menu-row | codex/TaskEditor.tsx | keep: layout (row inside a Menu) | Keep |
| deploy-log-head | none | Section header | Done |
| ex-head | - | Section header | Done |
| ex-row, ex-section-row | - | Row | Done |
| gh-head | none | Section header | Done |
| gh-item | none | Row | Done |
| gh-line | none | Row | Done |
| gh-list | none | Grouped list | Done |
| mcp-detail-head, mcp-tools-head | none | Section header | Done |
| mcp-item | - | Row | Done |
| mt-fold-head | - | Section header | Done |
| mt-item | - | Row | Done |
| mt-list | - | Grouped list | Done |
| mt-load-head | - | Section header | Done |
| mt-load-row | - | Row | Done |
| mt-log-item | - | Row | Done |
| mt-person-head | - | Section header | Done |
| mt-row | CSS only | Row (delete the unused rule) | Done |
| mt-rows | none | Grouped list | Done |
| mt-series-list | - | Grouped list | Done |
| mt-up-head | - | Section header | Done |
| obs-head, obs-subhead | none | Section header | Done |
| ov-ask-line | - | Row (AskRow) | Done |
| ov-brief-head | none | Section header | Done |
| ov-digest-head | none | Report card | Done |
| ov-digest-row | none | Report card | Done |
| ov-follow-row | codex/Overview.tsx | Row | Done |
| sm-line | codex/summary/Summary.tsx | Row | Done |
| wk-contest-head | none | Section header | Done |
| wk-feed-head | none | Section header | Done |
| wk-feed-list | none | Grouped list | Done |
| wk-head, wk-head-act | codex/GoalsPage.tsx, codex/Search.tsx, codex/TaskEditor.tsx, codex/jobs/JobPage.tsx, codex/jobs/Jobs.tsx, codex/meetings/MeetingList.tsx, codex/meetings/MeetingPage.tsx, codex/meetings/Person.tsx, codex/meetings/SeriesPage.tsx, codex/summary/Summary.tsx, codex/wiki/ReviewMode.tsx, codex/wiki/WikiIndex.tsx, codex/wiki/WikiPage.tsx | keep: layout (page title bar with actions, not a list header) | Keep |
| wk-label-row | none | Row | Done |
| wk-older-head | none | Section header | Done |

No hits: cp-* and the other listed prefixes have no class with these suffixes beyond the rows above.

Audited 7 Nov 2026 with `grep -rhoE "(^|[^a-z0-9-])(mt|ov|as|gh|wk|ex|ag|obs|sm|cp|mcp|deploy)-[a-z0-9-]*(row|head|header|line|dayline|list|item)s?(-[a-z0-9]+)?" web/src | sort | uniq -c`, then `grep -rlE "(^|[^a-z0-9-])<class>([^a-z0-9-]|$)" web/src --include="*.tsx"` per class for Files.

Each migration commit updates its row in the same diff.

#### Removed rules

Removed 7 Nov 2026 from web/src/styles/features. A class was dead when its name appeared in no file under web/src outside features (`grep -rwF "<class>" web/src --exclude-dir=features`), had no dynamic prefix match, and was not added by CodeMirror or xterm.

- assistant.css: as-chip-x, as-delete, as-edit-actions, as-edit-ago, as-edit-due, as-edit-meta, as-people, as-quote
- meetings.css: mt-body, mt-cal, mt-repeat, mt-title
- overview.css: ov-report, ov-wait
- wiki.css: sm-range

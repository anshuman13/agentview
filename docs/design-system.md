# Design system v2

Tokens live in web/src/styles/tokens.css (scales first, then roles); primitive styles live in
web/src/styles/components/*.css; React primitives live in web/src/ui (Button.tsx, Panel.tsx).
Features compose these and keep only layout in their own CSS. Components read role tokens
(`--type-*`, `--shape-*`, `--elev-*`, `--state-*`, colour roles), never raw scale values.

Sources: Elastic EUI for panels, empty prompts, density and colour roles; Material 3 for state
layers, elevation levels, the shape scale, type roles and touch targets.

## Principles

- Calm: violet-tinted near-black and greys (KiroCrew's kiro theme), Space Grotesk for text and JetBrains Mono for code, no borders where spacing does the job, hover only under
  `(hover: hover)`, short motion (`--dur`, 120ms; see Motion).
- Content first: chrome is quiet grey; controls get louder only when they act or are selected.
- One accent: violet `--accent` marks interaction (focus, selection, links, the one primary action).
  Agents are teal (`--agent`), so they never read as a control. Running work is violet `--accent-fill` (see Badge).
- Profile marks: Work blue (`--work`) and Personal magenta (`--personal`) are the only identity
  colours on tasks and lists. Status colours mark state, always next to text or an icon.
- Dense on desktop, roomy on touch: 28 and 36px controls with a pointer, 44px on coarse pointers.

### Scandinavian rules (Nov 2026)
The look to iterate towards: IKEA, Spotify and Nordic public-sector apps. Function first, little said, space
does the grouping. Applied page by page in the declutter work; the Autopilot page is the reference.
- One job per screen and one primary action. A page that does two things is two pages.
- Say less: a row is a short title and its current value as meta ("Away", "Off"; "Covers", "DMs and 3
  channels"). No sentences, no "how it works" prose and no hint paragraphs on the page; an explanation sits
  behind one info IconButton that opens a sheet, and a field's hint is its placeholder.
- Space, not boxes: groups are separated by whitespace and one hairline, never nested panels or borders.
  Spacing stays on the 4px scale (`--sp-*`); the big gaps between groups are `--sp-6`.
- Progressive disclosure: a settings row shows title and value and opens its editor on tap (a sheet on the
  phone, inline on desktop). Forms are never open by default. Lists show at most 5 rows, then "Show all N".
- Honest controls: a Switch only for on and off, Chips only for a pick from 2 to 5 values, a Field for
  text. No decorative chips, no counts that nobody acts on, no numbers in a meta line unless they are the
  value of the row.
- Two type sizes per screen (body and meta); hierarchy comes from weight and space, not from more sizes.
- Lagom: a screen holds 5 to 7 rows before anything folds. Related detail (activity, spend, logs) is one row
  that opens a page of its own.

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

`/design` is the visual review of every primitive, in every state, at desktop and phone width. It is opened from Settings, About, in dev mode or when the hub reports debug. A new primitive in `web/src/ui` gets its story added in `web/src/design/Stories.tsx`. The URL carries the state: `/design?theme=light|dark&width=phone|desktop#<primitive>`, all three optional and unknown values ignored, for example `/design?theme=light&width=phone#chip`. A query theme is not saved as the app theme. Each Block has a link button that copies its URL. A Block's name lowercased is its anchor, so a new primitive's Block name is its anchor.

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

### Sheet
`<Sheet label onClose className? overlayClassName? active? noSwipe?>` (web/src/ui/Sheet.tsx) is the bottom sheet. It provides the overlay (scrim, backdrop click closes with the slide-out), the drag handle, the Back entry, Escape and the `role="dialog"` card with `aria-label={label}`; children follow the handle. `className` is appended to `as-sheet`; `overlayClassName` replaces `as-sheet-overlay` (the More sheet uses `more-sheet-overlay mobile-only`). Mount it only while open (`{open && <Sheet>}`). Escape and Back close only the topmost active Sheet, one per press. A sheet that stays mounted under another passes `active={false}` so it registers neither (quick add under the date sheet). `noSwipe` sets `data-no-swipe`. New sheets use Sheet instead of copying the overlay, handle and dialog markup.

### Row
Height `--row-h` 40px (`--touch` on coarse pointers), padding `--list-pad`. Leading check or
icon, title in body type one line with ellipsis, meta in label type `--meta-fg`, trailing
IconButton sm or Chip shown on hover. Hairline only between groups.
`<Row leading title meta trailing lines href onClick>` (web/src/ui/Row.tsx, components/rows.css): 48px
minimum, title clamps to 1 or 2 lines, a hairline under each row starts at the title, state layers
as buttons, a button, a link (with href) or a plain div that holds its own controls and passes its props on (`plain`). A button or plain Row takes an optional `action` (one IconButton sm) beside it. Anatomy, left to right: optional leading (24px), title, one meta line, one state slot, optional menu. Title and meta are one line each with an ellipsis (Android `lines = 1`, `metaLines = 1`). `state` is the slot, at most one Badge or one short Status language word, fixed at `--row-state-w` (80px, Android `rowStateW`), content at its right edge, drawn whenever the prop is passed (`state={null}` keeps the columns aligned on rows with no state; Android `stateSlot`). `menu` (the Menu items) adds the one IconButton sm "kebab-vertical" labelled More through the `action` wrapper, last in the row; a long press opens it unless the caller passes `onLongPress`. `trailing` stays for content outside the anatomy (chevrons, counts). `AskRow` (web/src/ui/AskRow.tsx) is a Row with up to two actions at the end (one primary item and a More menu), used for Show all and the overview ask rows. Status: built; the topic timeline and meeting actions in Meetings, the digest, brief and Prep cards, the wiki page claims and search hits, and the Settings page use it.

Testing: Row, Section, Chip and AskRow are tested by rendering to static markup and asserting the root element, classes and each branch (plain, href, action) in `web/src/ui/Row.test.ts`, `longPress.test.ts` (the press timer), `Section.test.ts`, `Button.test.ts` and `AskRow.test.ts`. A new branch or class on one of them needs a case in its test. `web/src/app/pages.smoke.test.tsx` renders Overview, Tasks, Meetings and `/design` on an empty store; a new top-level page or list gets a case there. `web/src/design/a11y.test.tsx` checks the `/design` markup for accessible names and menu roles, and `web/src/design/stories.test.tsx` checks that every primitive in this section has a Block in `/design`.

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
- Digits-only exception: count badges (tab bar, nav, Section count, group counts, the phone Jump to latest reply count) stay a raw `.badge` with neutral, quiet, waiting or running tone and hold only digits.
- Progress exception: the Today header shows one quiet `.badge` "N of M done" in its Section `action` once N is at least 1.
- Running exception: running has no Status language word. It shows "Running" or "Live" in `--accent-fill` with a dot; a spec task marked ` (in progress)` shows "In progress" the same way, in place of its Start button.
- One Badge per Row, trailing, never beside a second state badge. Counts such as "N to confirm" and filter labels are plain muted text.

### EmptyState (EuiEmptyPrompt)
`<EmptyState icon title hint action size>`; `.ui-empty`. Centred: icon in a 48px `--hover`
circle (40px at sm) in `--on-surface-muted`, title role, hint in body `--on-surface-muted`,
then at most one action (a setup state names what is missing and its action is "Set up with <provider>", which asks the chat on screen). md for a whole view, sm inside a panel or report. The icon stays grey;
the accent is for the action.
Copy (Status language): the title is a sentence-case noun phrase with no trailing period ("No past meetings yet"), the hint is one short line with no period, and the one action is a Button sm directly under `.ui-empty`.
Status: built; used in `app/App.tsx`, `app/Unreachable.tsx`, `codex/Codex.tsx`, `codex/GoalsPage.tsx`, `codex/Overview.tsx`, `codex/PlanPreview.tsx`, `codex/Search.tsx`, `codex/TagPage.tsx`, `codex/jobs/JobPage.tsx`, `codex/jobs/Jobs.tsx`, `codex/meetings/Decisions.tsx`, `codex/meetings/Load.tsx`, `codex/meetings/MeetingList.tsx`, `codex/meetings/Person.tsx`, `codex/meetings/Review.tsx`, `codex/meetings/SeriesPage.tsx`, `codex/meetings/Week.tsx`, `codex/summary/Summary.tsx`, `codex/wiki/Feed.tsx`, `codex/wiki/ReviewMode.tsx`, `codex/wiki/WikiIndex.tsx`, `codex/wiki/WikiPage.tsx`, `ops/Deploy.tsx`, `ops/Findings.tsx`, `ops/GitHub.tsx`, `ops/McpDetail.tsx`, `ops/McpStatus.tsx`, `ops/Observe.tsx`, `sessions/AgentsPane.tsx`, `sessions/Sessions.tsx`, `workspace/BrowserPane.tsx`, `workspace/Explorer.tsx`.

### Grouped list (iOS inset grouped)
Overview cards (`.as-group`), the Meetings list and Meetings day groups are
inset grouped lists: page `--group-page` (grey #F2F2F7 in light, black in dark), card `--group-card`
(white in light, #1C1C1E in dark), `--shape-lg` radius, no border, rows 44px minimum with a hairline
inset to the text start. The Codex task lists, Goals, Search, Jobs and Summary (`.ui-group`), the editor Links, the wiki page claims and search hits (`.ui-group`) and the Meetings list (`.as-group` under `.mt-page`) use it. Section labels above cards are Footnote size, `--fg-muted`, sentence case. A grouped card whose rows sit in wrappers (the Reply queue: `.ov-ask`) draws the inset hairline on the wrapper at the row's text start (52px with a lead, else `--list-pad`), never on the row and never full width.

### Section header
A header that heads a list of rows shows its full row count as the quiet Badge (`count={sectionCount(n)}`), including rows behind "Show all N" or a cap, and omits it at 0. A header over a single card, form or free text shows none. Series counts only its repeated rows, the rest are context.

Label type, `--fg-muted`, padding `--sp-4 --list-pad`, optional count Badge quiet and a
trailing IconButton sm (a text Button sm plain is allowed too). 44px hit area at max-width 480px. Collapsible headers rotate a chevron; no fill, state layer on hover.
`<Section label count action open onToggle>` (web/src/ui/Section.tsx, components/sections.css); with
`onToggle` the header is a button with `aria-expanded`. At max-width 480px a header that heads a group in Tasks, Meetings or the Today block is sticky at the top of its scroll container, opaque `--bg`, `--z-raised`. Status: built; the Meetings day headers, the Codex page and tag page headers, the reply draft header, the Observe panes, the Deploy log, the MCP detail pane, every Fold, the report card and next-meeting card heads and the Week goals card and the Settings page use it.

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
  that have a More menu take it, and the kebab stays as the visible action. Exception: a chat row's long press renames the chat in place and does not open the menu.
- Haptics: `haptic('tap')` on a swipe action, a drag pick-up and a touch drop on a section, a long press and a pull refresh; `haptic('success')` on completing a task. In the phone app they go through the Tauri haptics plugin (tap is light impact, success is success notification) and fall back to `navigator.vibrate`; on the web and on desktop they do nothing where vibrate is missing. Reopening, kebab and button taps give none.
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
- A Badge per row at most one, for state only (Needs you, Failed, Needs review on a wiki page row, which has only the title, the badge and a More menu with Open and Archive). Badges are not labels for things the
  title already says.
- Jobs rows follow this: one badge (Running, Queued, Failed, Off, set by `jobState`), and a More menu with Run now, Edit,
  Disable or Enable, Delete (long press opens it on phones). Meta is the schedule and next run only. No Run now button, no switch and no last-run line on the row.
- On phones a list restores its scroll position when the user returns from an item page, keyed by route (list and profile filter), once per return. Tasks and Meetings.
- Tasks as built: a Tasks row is the title, a meta line (due, then at most one of Repeats, checklist count, High or
  Medium; no tags, none on done rows), the check as Done, a Needs you Badge on suggested tasks in the state slot (every row passes the slot, so titles line up) and one More Menu
  (Open, Snooze, Tomorrow, Move, Delete). Title and meta are one line on the phone too. A touch hold on a web task row starts selection, so it does not open the menu. A day group is a Section header over one Grouped list; the round + is the only add control. The checklist is read and toggled on the task page.
- Meetings as built: a meeting row is the title with the profile dot, a meta line (time with the weekday beyond today,
  room, N people), at most one Badge (Live) in the state slot, which every row passes, and one More Menu on the web (Open calendar, Notes; the phone row has none). No avatars, tile or
  count badges; a transcript hit replaces the meta as a 2-line clamp.

### Overview page
The day at a glance on a phone. Three blocks in a fixed order, nothing else on the page: what is next, what needs
me, what is left today. After the Skeleton while loading, a block with nothing in it is not rendered.
1. **Up next**: one card, first match wins. A Section header (Up next) over a Grouped list of one Row. (a) The next
   meeting today that has not ended: title, one meta line (time, room, N people), one More
   IconButton sm (Menu: Prep, Open calendar, Notes) and no Prep Button; the whole Row opens the meeting. (b) With no meeting left, the first
   open task due today by due time (overdue tasks do not count): title, due time as meta, a Done Button sm; the
   title opens the task. (c) With neither, one EmptyState md (icon pass, "Nothing today"): the hint names the
   next day with a meeting or a task ("Next: <when> <title>", or "Nothing planned. Add a task to start the day.")
   and one primary New task Button sm opens the add sheet.
2. **Needs you**: shown only when the count is above zero. One button Row (Row density) titled "Needs you" with a
   quiet count Badge and a chevron, no actions. The count is the Needs you list plus the Reply queue. It opens a
   sheet (`as-sheet-overlay`, `Back`, `useSheetDrag`, role dialog) with a Needs you Section header carrying the total,
   then Tasks and Asks Sections over Grouped lists and the Replies Report card (empty groups have no header); Esc, the scrim and the back gesture close it and focus returns to the row. No row carries a Badge: Overdue and At risk are the start of the meta line ("Overdue · due Mon"); the Section count Badges stay. DM and Slack rows have no visible X: Dismiss is the last More item and a left swipe dismisses with the one 5 s Undo snack; ask rows swipe left the same (Not mine on the web, Dismiss on the phone). On the phone an ask row shows one Add button and More (Open, Dismiss), and Make task and Dismiss on a DM or Slack row are More items. From 901px wide the sheet is a centred dialog (`as-dialog` on `Sheet`: `min(600px, 100% - 2 * --sp-8)` wide, at most 80% high, `--radius-sheet` on all corners, no handle); below that it is the bottom sheet.
3. **Today**: Section header with no count over one Grouped list of Rows in time order: the rest of today's
   meetings (title, time, a Live badge while it runs, no actions) and open tasks due today or overdue, overdue
   first (title, due time or a Late Badge, a leading check IconButton sm and one More IconButton sm with Snooze to
   tomorrow and Open). Seven rows, then a "Show all N" quiet Button sm that expands in place. From the first task done today the header's action slot holds a quiet "N of M done" Badge (Badge progress exception); it is absent at N = 0.

The page header is the title and the menu button only: with no count line. A running focus timer shows in its bar.

Job runs: a job page shows run history from one Row (Row density) inside a Grouped list, titled Runs, with the last run's time and Badge and a chevron; it opens a sheet (`as-sheet-overlay`, `Back`, `useSheetDrag`, role dialog) of the 10 latest runs, and focus returns to the row on close.

Page shell: Codex pages and the Observe, Deploy, MCP and GitHub lists are `.wk` > `.wk-scroll` > `.mt-page` and add no wrapper, padding or background of their own. Their Page hero, the MCP grid and the GitHub detail keep their own layout. Agents keeps its fixed sidebar and takes only Row density and Grouped list styling.

### Status language
- Outcomes are nouns in sentence case: Sent, Failed, Skipped, Waiting, Edited. Counts as "1 sent", "2 failed".
- "Needs you" is the only phrase for work the user must do; use it as a Badge, not in prose.
- Reasons are under 6 words in meta: "someone else answered", "second ask in 3 days".
- Times are relative within today ("14:20"), a weekday beyond ("Tue"), from `clock` and `ago` in codex/time.

### Writing (KiroCrew style, Nov 2026)
- Sentence case, plain words, second person. No exclamation marks, no em dashes; a middle dot joins hints
  ("Enter saves · Esc cancels").
- Labels are short verbs: "New", "Pin", "Copy link", "Mark as unread". In progress ends in an ellipsis: "Saving…".
- An error says what failed, then what state things are in or what to do, in one line at most:
  "Could not save the note. Your text is still here." "Could not send. Nothing was sent, try again."
- A confirm states the consequence: "Delete this chat? This cannot be undone." "Archive the worktree? No commits are lost."
- An empty state says what appears there and how it gets there, in one line: "Chats you pin show here."
- The one extra line is the limit. Settings rows stay title and value (Scandinavian rules); explanations stay
  behind the info button.

## Phone (web)

- **Bottom bar**: at max-width 900px the tab bar is a pill floating `--sp-4` from the sides and `--sp-2` above the safe area (`--raised`, `--elev-2`), with `--accent-soft` filling the selected tab. The composer is a pill (`--radius-pill`, `--elev-1`) just above it, with + and a mic or Send; above one line its radius becomes `--shape-lg`. The bar hides on the Chat tab while composing (`data-composing` on `.workbench`) and slides back in `--dur`; reduced motion shows and hides it instantly.

## Phone (native Android)

Rules for the native app in `android/`. TokenGen applies `NATIVE_OVERRIDES`, `NATIVE_COLORS`, `NATIVE_SIZES` and `NATIVE_TYPE` after reading `tokens.css`, so Material wins over the web touch tokens there and `Tokens.kt` stays generated.

### Foundations
- **Spacing** is on the 4dp grid: sp2 4, sp4 8, sp6 12, sp8 16, sp12 24, sp16 32. sp1, sp3, sp5 and sp7 exist only so old call sites compile; new code does not use them. The screen margin is 16dp (`listPad`) on both sides and groups sit 24dp apart.
- **Touch targets** are 48dp with 8dp between targets. Painted controls may be smaller (Chip 32, Button sm 32) and reach 48 through `minimumInteractiveComponentSize`.
- **Icons** are 24dp as standard (IconBtn, nav, FAB, row leading, search), 20 inline in text and 18 in chips and buttons. Menu items use 24.
- **Rows** are 56dp with a title only and 72dp with meta; three-line rows grow to about 88dp. Leading element and text are 16dp apart.
- **Type** is on a 4dp line grid. Reading text is never below 14sp; 12sp is for badges, nav labels and captions. Text uses `fg` or `fgMuted`, never `fgFaint` (3.3:1 to 3.9:1 on bg and surface, below 4.5:1), which is for icons and disabled states.

| Role | Size/line | Weight |
|---|---|---|
| largeTitle | 32/40 | 700 |
| display | 28/36 | 700 |
| title | 22/28 | 700 |
| headline, body | 16/24 | 600, 400 |
| callout | 14/20 | 500 |
| subheadline, meta, footnote | 14/20 | 400 |
| caption | 12/16 | 400 |
| label | 12/16 | 500 |
| Mono | 14/20 | 400 |

- **Header** is 64dp with a 22sp one-line title and an optional muted subheadline subtitle, and at most one action on a page (more go in a More menu). On the web phone the same header is `PhoneHeader` (`.wk-head`: Back, a one-line title, a muted subtitle and one trailing control) for Observe, Deploy, MCP, Settings, Files, Source Control and Pull Requests; a Section label that repeats that title is not rendered there. The scope chip shows only on tab roots, never on a page with a back button.
- **Sheet** opens with a title row (56dp, 22sp, an optional count and one trailing icon action), and its rows sit in Groups.
- **Menu icons** are 24dp, and a menu opened from a kebab keeps 12dp from the screen edge.
- **Loading and EmptyState**: a loading page shows `Loading` (spinner and one line). A page-level EmptyState has an icon and `small = false`. A section's EmptyState is small and sits under its SectionHeader, never inside a Group.

- **Separation** is by tone (see Colour below): `bg` page, `surface` for bars and cards, `raised` for menus and dialogs. Hairlines only sit between rows of a group.

### Colour
Colours are Material 3 roles. `NATIVE_COLORS` in TokenGen sets each value for both themes, and `Theme.kt` maps every `colorScheme` slot, so Switch, pickers, dialogs and sheets need no call-site colours.

| Role | Token | Dark | Light | Use |
|---|---|---|---|---|
| background | `bg`, `groupPage` | #19161D | #FFFFFF | page |
| containerLowest | `containerLowest` | #141118 | #FFFFFF | code, diff and output wells |
| containerLow | `containerLow` | #1C1922 | #FAFAFA | sheets |
| container | `surface`, `groupCard` | #211D25 | #F5F5F5 | grouped cards, nav bar, rail, user bubble, terminal |
| containerHigh | `raised` | #28242E | #F0F0F0 | composer, menus, dialogs, pickers |
| containerHighest | `sunken`, `hover` | #2F2A36 | #E9E8EC | text fields, Gray button, Default and Quiet badges, empty-state icon disc |
| onSurface | `fg`, `fgStrong` | #DCDADF / #F2F1F4 | #19161D | text |
| onSurfaceVariant | `fgMuted`, `metaFg` | #B8B4BF | #4A464F | secondary text |
| outline | `fgFaint`, `borderStrong` | #938F9B | #79747E | icons, disabled, check rings; never text |
| outlineVariant | `border`, `borderCard` | #4A464F | #D4D4D8 / #E4E4E7 | hairlines |
| primary | `accent`, `accentText`, `link` | #C19AFF | #7A35E0 | links, selection, focus |
| primary fill | `accentFill` | #C19AFF | #8E48FF | primary button |
| onPrimary | `onAccent` | #2A0063 | #FFFFFF | text on the fill |
| primaryContainer | `primaryContainer` | #4B1C99 | #EBDCFF | FAB |
| onPrimaryContainer | `onPrimaryContainer` | #EBDCFF | #2A0063 | FAB glyph |
| secondaryContainer | `accentSoft` | #3A2F4D | #EDE4FF | nav indicator, selected chip, Tinted button, selected row |
| onSecondaryContainer | `onSecondaryContainer` | #E8DEF8 | #21182B | content on those |
| inverseSurface | `inverseSurface` | #E6E1E9 | #322F35 | snackbar |
| inverseOnSurface | `inverseOnSurface` | #322F35 | #F5EFF7 | snackbar text |
| inversePrimary | `inversePrimary` | #7A35E0 | #D3BBFF | snackbar action |

Status pairs: the colour is for text and icons on the surfaces; the container holds a badge or banner with its on-container text.

| Status | Colour | Container | On-container |
|---|---|---|---|
| ok | #5FD38D / #00703A | #00522A / #C4F2D3 | #9CF6B8 / #00210E |
| warn | #E0B94D / #7A6400 | #5A4300 / #FFE08B | #FFE08B / #241A00 |
| err | #FF8A96 / #C01D3E | #8C1D2E / #FFDADC | #FFD9DC / #40000C (`onErr` #5C0016 / #FFFFFF) |
| agent (running, agents) | #43C9BD / #00696B | #00504A / #9FF2E7 | #9FF2E7 / #00201F (`onAgent` #003733 / #FFFFFF) |
| info (new, unread, upcoming) | #6F9AE0 / #285092 | #1E3A66 / #D6E3FF | #D6E3FF / #001A41 |

Profile dots: work #6F9AE0 / #285092, personal #E8A3FF / #8E3FAA. Scrim is `scrimStrong`.

Contrast ratios (worst case is text on `sunken`; `ContrastTest` checks them).

| Theme | Text on surfaces | Icons only | Fill pairs |
|---|---|---|---|
| Both | fg, fgMuted, accent and status at least 4.5 on every surface (light ok, at 5.1, is lowest) | fgFaint, borderStrong and profile dots at least 3 on bg and surface | every on-colour pair at least 4.5 |

Rules:
- Text is `fg` or `fgMuted`, never `fgFaint`.
- Accent is only for the primary action, links and selection, never for status.
- A status colour always appears with an icon or a word. There is no decorative colour.
- Profile hues are only 8dp dots beside the profile word.
- Toggle on is primary violet, not green.
- Terminal ANSI 0 and 8 follow `fgFaint`, and terminal default text follows `fg`, so both shift with the theme.

### Interaction
- Every clickable has the default Material ripple (`indication = null` only on a scrim); IconBtn's is circular.
- A row with a More menu shows the kebab, and long press opens the same menu with a long-press haptic. Long press is never the only route.
- A swipe action (`SwipeToDismissBox`: start-to-end done or pin, end-to-start snooze or archive) also sits in the menu and shows a 5 s Undo snack.
- Menus over 5 items, forms and pickers open in `Sheet`.
- Back is system predictive back (`enableOnBackInvokedCallback` is on). `BackHandler` is only for in-screen state; there is no in-app edge swipe and no swipe between tabs.
- Hide on scroll and the FAB follow the navigation spec.

### Worked example: Wiki page
The Wiki page keeps 16dp side margins and 16dp above the title. In the hero, title, meta line and summary are 8dp apart. Claim rows clamp to 3 lines and a tap expands the row in place. The index shows one "Review claims" row instead of a header button. Older becomes a collapsible SectionHeader "Not used by Claude" (chevron, 48dp, no Show/Hide button and no hint sentence).

## Migration

Done: Summary uses Panel (filter card), every empty list or report uses EmptyState (the old
`.as-empty` and `.empty-state` styles are gone), and the menus use Menu. Chips are done: as-chip, cp-chip, mcp-chip and ag-chip use Chip, which takes `tone` (`work`, `personal`, `accent`) and `quiet` (dashed, faint). `mt-add` stays a form, since it is an input row, and uses Chip tokens (height, radius, accent-soft on focus).

As of 9 Nov 2026 the light and dark themes use KiroCrew's kiro palette: #19161D or white page, #211D25 or #FAFAFA for cards and chrome, violet #8E48FF accent, teal agents, blue work, and Space Grotesk with JetBrains Mono on web and phone. Meeting and knowledge icons are neutral.

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
| obs-hint empty variants | ops/Observe.tsx | EmptyState | Partial (error, warn, ok, mono, loading stay as layout) |
| obs-ask | ops/Observe.tsx | Button | Partial (Snowflake action stays) |
| ov-ask-line | - | Row (AskRow) | Done |
| settings-* | - | Section and Row | Done |
| sm-line | codex/summary/Summary.tsx | Row | Done |
| wk-claim | codex/meetings/OpenQuestions.tsx, codex/meetings/Person.tsx, codex/meetings/Pins.tsx, codex/meetings/Raise.tsx | Row | Partial |
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

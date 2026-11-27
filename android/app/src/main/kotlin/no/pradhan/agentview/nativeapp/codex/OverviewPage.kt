package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.ui.UNTITLED
import no.pradhan.agentview.nativeapp.codex.meetings.todayTaskMenu
import no.pradhan.agentview.nativeapp.codex.meetings.countdown
import no.pradhan.agentview.nativeapp.codex.meetings.isLive
import no.pradhan.agentview.nativeapp.codex.meetings.joinMinutes
import no.pradhan.agentview.nativeapp.codex.meetings.isSolo
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import androidx.compose.ui.platform.LocalUriHandler
import no.pradhan.agentview.nativeapp.codex.meetings.meetingMeta
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import kotlinx.coroutines.flow.update
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.app.countChat
import no.pradhan.agentview.nativeapp.app.AgentGroup
import no.pradhan.agentview.nativeapp.app.agentGroup
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.AvIcon
import androidx.compose.material3.Text
import no.pradhan.agentview.nativeapp.chat.AttachButton
import no.pradhan.agentview.nativeapp.chat.ChatTone
import no.pradhan.agentview.nativeapp.chat.Dictation
import no.pradhan.agentview.nativeapp.chat.VoiceButton
import no.pradhan.agentview.nativeapp.chat.appendWord
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.app.askCodex
import no.pradhan.agentview.nativeapp.app.codexProfile
import no.pradhan.agentview.nativeapp.sessions.folderName
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.app.openConnectors
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.ChipTone
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.LocalCardGroups
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.plural
import no.pradhan.agentview.nativeapp.ui.select

@Composable
fun AskBar(hub: Hub, st: CodexState, profile: String?) {
    val text by hub.codexDraft.collectAsState()
    val uploading by hub.codexUploads.collectAsState()
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    val guess = profile ?: picked ?: remember(text, st.meetings) { guessProfile(text, st.meetings, hub.codexProfile) }
    val send = {
        val q = text.trim()
        if (q.isNotEmpty() && uploading == 0) {
            val p = guess
            picked = null
            hub.askCodex(askIn(st, q, p), p)
            hub.setCodexDraft("")
        }
    }
    val recipes = remember(text) { matchRecipes(DEFAULT_RECIPES, text) }
    Column {
        if (profile == null && text.isNotBlank()) Row(Modifier.padding(start = Tokens.listPad, top = Tokens.sp3)) {
            Chip(profileLabel(guess), { picked = if (guess == WORK) PERSONAL else WORK }, tone = if (guess == WORK) ChipTone.Work else ChipTone.Personal)
        }
        if (recipes.isNotEmpty()) Group {
            recipes.forEachIndexed { i, r -> if (i > 0) Hairline(); ListRow(r.title, onClick = { hub.setCodexDraft(r.text) }) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), verticalAlignment = Alignment.CenterVertically) {
            AttachButton(hub, { n -> hub.codexUploads.update { it + n } }, choose = false) { mark -> hub.setCodexDraft(appendWord(hub.codexDraft.value, "$mark ")) }
            TextField(text, hub::setCodexDraft, Modifier.weight(1f), placeholder = if (uploading > 0) "Uploading image…" else "Ask Codex about your day, or / for recipes", singleLine = true, pill = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }))
            val dictation = remember { Dictation() }
            VoiceButton({ spoken, final -> dictation.apply(text, text.length, spoken, final)?.let { hub.setCodexDraft(it.first) } }, { hub.notice.value = it })
            IconBtn("send", "Send", { send() }, enabled = text.isNotBlank() && uploading == 0, on = text.isNotBlank() && uploading == 0)
        }
    }
}

private const val TODAY_SHOWN = 5

private class OverviewData(val profile: String?, val s: Split, val mt: Meetings, val needs: List<Need>, val needsTotal: Int, val today: Today, val rows: List<Triple<Long, Row?, Row?>>)

@Composable
private fun rememberOverviewData(hub: Hub, st: CodexState, profile: String?, now: Long): OverviewData {
    val s = remember(st.items, profile, now / 60_000) { split(st.items, profile, now) }
    val mt = remember(st.meetings, profile, now / 60_000) { meetingsOf(st.meetings, profile, now) }
    val counts by hub.counts.collectAsState()
    val needsView by hub.needed.collectAsState()
    val needs = needsView.list
    val today = remember(st, profile, s, mt, needs) { overviewToday(s, mt.next, now, riskKeys(needs)) }
    val others = mt.today.filter { it != mt.next && (it.endsAt ?: it.startsAt!!) > now }
    val rows = remember(today, others) {
        today.late.map { Triple(it.at ?: 0L, null as Row?, it) } + (others.map { Triple(it.startsAt!!, it, null as Row?) } + today.todo.map { Triple(it.at ?: 0L, null as Row?, it) }).sortedBy { it.first }
    }
    return OverviewData(profile, s, mt, needs, counts.needsYou, today, rows)
}

@Composable
fun OverviewPage(hub: Hub, st: CodexState, profile: String?, now: Long, actions: TaskActions, onOpen: (Row) -> Unit, onNeeds: () -> Unit, onGoals: () -> Unit, onAdd: () -> Unit, onMeeting: (Row) -> Unit, onNotes: (Row) -> Unit) {
    val d = rememberOverviewData(hub, st, profile, now)
    val goals = remember(st.items, profile, now / 60_000) { goalsOf(st.items, now, profile) }
    val free = remember(st.meetings, profile, now / 60_000) { weekFreeMinutes(timedMeetings(st.meetings, profile).map { it.startsAt!! to it.endsAt!! }, now) }
    var all by remember { mutableStateOf(false) }
    var plan by remember { mutableStateOf<List<PlanSlot>?>(null) }
    val live by hub.store.state.select { it.live }
    val seen by hub.workspace.select { it.seen }
    val shown by hub.store.state.select { it.shownId }
    val groups = remember(live, seen, shown) { agentGroups(live, seen, shown) }
    val failedCalendars = remember(st.scans) { failedCalendars(st.scans) }
    CompositionLocalProvider(LocalCardGroups provides true) { LazyColumn(Modifier.fillMaxSize()) {
        if (failedCalendars.isNotEmpty()) item(key = "failed-calendars") {
            Group { failedCalendars.forEachIndexed { i, h -> if (i > 0) Hairline(); ListRow(calendarFailText(h, failedCalendars.size), h.ok?.let { "Last synced ${clock(it)}" } ?: "Never synced", trailing = if (hub.readOnly) null else ({ Button("Reconnect", { hub.openConnectors(calendarAccount(h)) {} }, size = ButtonSize.Sm) })) } }
        }
        morningSection(hub, st, profile, now)
        item(key = "up-next") { UpNextSection(hub, st, d, now, actions, onOpen, onNeeds, onAdd, onMeeting, onNotes) }
        agentSections(groups) { hub.link.value = DeepLink(chat = it) }
        if (d.rows.isNotEmpty()) todaySection(d, now, actions, all, { all = true }, onOpen, onMeeting)
        if (d.s.overdue.isEmpty() && d.s.today.isEmpty()) ideasSection(hub, st, d, now)
        planDaySection(d, plan, { plan = it }, now, actions)
        if (goals.isNotEmpty()) goalsSection(st, profile, goals, free, onGoals)
        item(key = "end") { androidx.compose.foundation.layout.Spacer(Modifier.padding(bottom = Tokens.fab + Tokens.sp20)) }
    } }
}

@Composable
private fun UpNextSection(hub: Hub, st: CodexState, d: OverviewData, now: Long, actions: TaskActions, onOpen: (Row) -> Unit, onNeeds: () -> Unit, onAdd: () -> Unit, onMeeting: (Row) -> Unit, onNotes: (Row) -> Unit) {
    val mt = d.mt
    val task = d.today.upNextTask
    if (mt.next != null || task != null) {
        SectionHeader("Up next")
        Group {
            mt.next?.let { m ->
                val prep: () -> Unit = { hub.askCodex(askIn(st, prepText(m), m.profile), m.profile) }
                MeetingRow(m, now, upNext = true, onPrep = prep.takeIf { !hub.readOnly }, onNotes = { onNotes(m) }) { onMeeting(m) }
            }
            if (mt.next != null && task != null) Hairline()
            task?.let { ListRow(it.title ?: "", it.at?.let { a -> clock(a) }, onClick = { onOpen(it) }, trailing = { Button("Done", { actions.done(it) }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm) }) }
        }
    } else {
        val later = d.s.later.filter { it.at != null }.minByOrNull { it.at!! }
        val title = when {
            later != null && (mt.nextLater == null || later.at!! < mt.nextLater.startsAt!!) -> "Nothing today. Next: ${whenText(later.at!!, now)} ${later.title}"
            mt.nextLater != null -> "Nothing today. Next: ${whenText(mt.nextLater.startsAt!!, now)} ${mt.nextLater.title}"
            else -> "Nothing today"
        }
        if (hasOpenTasks(st.items, d.profile)) EmptyState(title, icon = "pass")
        else EmptyState(title, icon = "pass") { Button("New task", onAdd, variant = ButtonVariant.Filled, size = ButtonSize.Sm) }
    }
    if (d.needsTotal > 0) {
        Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Needs you", onClick = onNeeds, trailing = { Badge("${d.needsTotal}", BadgeTone.Quiet); Chevron() }) }
    }
}

// Today's morning brief, as Duet writes it: the headline, then one "Topic: status" line each; Close hides it for the day.
private fun LazyListScope.morningSection(hub: Hub, st: CodexState, profile: String?, now: Long) {
    item(key = "morning") {
        var hidden by remember { mutableStateOf(hub.prefs.getStringSet(MORNING_HIDDEN, emptySet()).orEmpty()) }
        val all = remember(st.briefs, profile, now / 60_000) { morningBriefs(st.briefs, profile, now) }
        val lines = remember(all) { all.associate { it.key to morningLines(parseMorningRows(it.str("rows"))) } }
        for (b in all.filter { it.key !in hidden }) {
            Group {
                Column(Modifier.padding(start = Tokens.sp8, end = Tokens.sp2, top = Tokens.sp2, bottom = Tokens.sp6)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text((if (profile == null) "${if (b.profile == "work") "Work" else "Personal"} · " else "") + (b.str("text") ?: ""), style = Type.headline, color = av.fg, modifier = Modifier.weight(1f))
                        IconBtn("close", "Close brief", {
                            hidden = morningBriefs(st.briefs, null, now).map { it.key }.filter { it in hidden }.toSet() + b.key
                            hub.prefs.edit().putStringSet(MORNING_HIDDEN, hidden).apply()
                        })
                    }
                    for (l in lines[b.key].orEmpty()) Text(
                        buildAnnotatedString { withStyle(SpanStyle(color = av.fg, fontWeight = FontWeight.SemiBold)) { append("${l.label}: ") }; append(l.text) },
                        style = Type.subheadline, color = av.fgMuted, modifier = Modifier.padding(end = Tokens.sp6, top = Tokens.sp1),
                    )
                }
            }
        }
    }
}

private const val MORNING_HIDDEN = "morning:hidden"
private const val IDEAS_HIDDEN = "ideas:hidden:list"

// Muse's Ideas: up to three open tasks an agent could take on, each as "I can help: …"; Start asks Codex about it, Not now hides it.
private fun LazyListScope.ideasSection(hub: Hub, st: CodexState, d: OverviewData, now: Long) {
    item(key = "ideas") {
        var hidden by remember { mutableStateOf(hub.prefs.getString(IDEAS_HIDDEN, "").orEmpty().split("\n").filter { it.isNotEmpty() }) }
        val ideas = remember(d.s, hidden) { pickIdeas(d.s.overdue + d.s.today + d.s.later, hidden.toSet()) }
        if (ideas.isEmpty()) return@item
        val start = { r: Row -> hub.askCodex(askIn(st, "Help me with this item.", r.profile, r), r.profile) }
        SectionHeader("Ideas")
        Group {
            ideas.forEachIndexed { i, r ->
                if (i > 0) Hairline()
                val due = r.at
                val meta = when { due == null -> "No due date"; due < now -> "Overdue · was due ${whenText(due, now)}"; else -> "Due ${whenText(due, now)}" }
                ListRow(ideaTitle(r.title ?: ""), meta, leading = { AvIcon("lightbulb", null, Tokens.iconMd, tint = av.fgMuted) }, onClick = { start(r) }, trailing = {
                    if (!hub.readOnly) Button("Start", { start(r) }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm)
                    IconBtn("close", "Not now", {
                        hidden = (hidden - r.key + r.key).takeLast(50)
                        hub.prefs.edit().putString(IDEAS_HIDDEN, hidden.joinToString("\n")).apply()
                    })
                })
            }
        }
    }
}

// Live chats in Duet's groups, in AgentGroup order; the chat on screen is left out.
fun agentGroups(live: List<LiveChat>, seen: Map<String, Long>, viewing: String = "") =
    live.filter { it.id != viewing }.mapNotNull { c -> agentGroup(countChat(c, seen))?.let { it to c } }.groupBy({ it.first }, { it.second }).toSortedMap().toList()

private fun LazyListScope.agentSections(groups: List<Pair<AgentGroup, List<LiveChat>>>, onOpen: (String) -> Unit) {
    for ((g, chats) in groups) {
        item(key = "agents:${g.name}") { SectionHeader(g.label, count = "${chats.size}") }
        item(key = "agents:${g.name}:rows") {
            val tone = when (g) { AgentGroup.Input -> av.warn; AgentGroup.Working -> av.accentText; AgentGroup.Review -> av.ok }
            Group {
                chats.forEachIndexed { i, c ->
                    if (i > 0) Hairline()
                    val detail = if (g == AgentGroup.Input) "Waiting for you" else c.status.ifBlank { if (g == AgentGroup.Working) "Working" else "Finished" }
                    val meta = buildAnnotatedString {
                        withStyle(SpanStyle(color = tone, fontWeight = FontWeight.SemiBold)) { append(g.label) }
                        append(" · $detail · ${folderName(c.cwd)}")
                    }
                    ListRow(c.title.ifBlank { UNTITLED }, meta, onClick = { onOpen(c.id) })
                }
            }
        }
    }
}

private fun LazyListScope.todaySection(d: OverviewData, now: Long, actions: TaskActions, all: Boolean, onShowAll: () -> Unit, onOpen: (Row) -> Unit, onMeeting: (Row) -> Unit) {
    val rows = d.rows
    item(key = "today") { SectionHeader("Today", action = doneCount(d.s.doneToday.size, d.today.openCount)?.let { t -> { Badge(t, BadgeTone.Quiet) } }) }
    val shown = if (all) rows else rows.take(TODAY_SHOWN)
    item(key = "today:rows") {
        Group {
            shown.forEachIndexed { i, (_, m, r) ->
                if (i > 0) Hairline()
                if (m != null) MeetingRow(m, now, upNext = false) { onMeeting(m) }
                else if (r != null) TodayTaskRow(r, r in d.today.late, actions, onOpen)
            }
        }
        if (rows.size > shown.size) Button("Show all ${rows.size}", onShowAll, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    }
}

// Proposes slots for today's estimated tasks in the free work gaps; Accept sets each task's due time, with one undo.
private fun LazyListScope.planDaySection(d: OverviewData, plan: List<PlanSlot>?, onPlan: (List<PlanSlot>?) -> Unit, now: Long, actions: TaskActions) {
    val tasks = listOfNotNull(d.today.upNextTask) + d.today.todo
    val plans = { tasks.map { PlanTask(it, it.at, hasTime(it.at)) } }
    fun accept(slots: List<PlanSlot>) {
        for (x in slots) actions.edit(x.task.row, mapOf("at" to x.span.first))
        onPlan(plan?.filter { it !in slots }?.takeIf { it.isNotEmpty() })
        actions.undoable("Planned ${plural(slots.size, "task")}") { slots.forEach { actions.edit(it.task.row, mapOf("at" to it.task.row.at)) } }
    }
    if (plan == null) {
        // The offer shows in the morning only (web PlanDay).
        if (java.util.Calendar.getInstance().apply { timeInMillis = now }.get(java.util.Calendar.HOUR_OF_DAY) >= 12) return
        if (tasks.none { !hasTime(it.at) && estimateMinutes(it.title) != null }) return
        item(key = "plan:button") {
            Button("Plan my day", {
                val busy = d.mt.today.filter { it.endsAt != null && it.endsAt!! > it.startsAt!! && it.endsAt!! - it.startsAt!! < 20 * 3_600_000L }.map { it.startsAt!! to it.endsAt!! }
                val slots = planToday(plans(), busy, now)
                if (slots.isNotEmpty()) onPlan(slots) else actions.say("No estimated task fits the free time today")
            }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        }
        return
    }
    item(key = "plan") { SectionHeader("Plan my day", action = { Button("Close", { onPlan(null) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
    item(key = "plan:rows") {
        Group {
            plan.sortedBy { it.span.first }.forEachIndexed { i, x ->
                if (i > 0) Hairline()
                ListRow(x.task.title ?: "", "${clock(x.span.first)} - ${clock(x.span.second)}", trailing = { Button("Accept", { accept(listOf(x)) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })
            }
        }
        Button("Accept all", { accept(plan) }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Filled, size = ButtonSize.Sm)
    }
}

@Composable
private fun TodayTaskRow(r: Row, late: Boolean, actions: TaskActions, onOpen: (Row) -> Unit) {
    ListRow(
        r.title ?: "", if (late) null else r.at?.let { clock(it) },
        leading = { CheckCircle(false, "Mark ${r.title} done") { actions.done(r) } },
        trailing = {
            if (late) Badge("Late", BadgeTone.Failed)
            MoreButton { close ->
                if ("moveToday" in todayTaskMenu(late)) MenuItem("Move to today", "calendar", { close(); actions.moveToToday(listOf(r)) })
                MenuItem("Snooze to tomorrow", "clock", { close(); actions.snoozeLater(r) })
                MenuItem("Open", "arrow-right", { close(); onOpen(r) })
            }
        },
        onClick = { onOpen(r) },
    )
}

private fun LazyListScope.goalsSection(st: CodexState, profile: String?, goals: List<Row>, free: Long, onGoals: () -> Unit) {
    // One goal shows itself; several fold into one row that opens the week's goals (web GoalsBlock).
    item(key = "goals") {
        val meta = remember(st.items, goals, free, profile) {
            if (goals.size > 1) goalsLine(goals.map { g -> goalProgress(st.items, g).let { GoalTally(it.done, it.total, goalAtRisk(st.items, g, free)) } })
            else goals[0].let { g ->
                val p = goalProgress(st.items, g)
                listOfNotNull("At risk".takeIf { goalAtRisk(st.items, g, free) }, if (p.total > 0) "${p.done}/${p.total} done" else "No tasks yet", if (p.total == 0) null else if (p.done == p.total) "All done" else "Next: ${goalNext(st.items, g)}").joinToString(" · ")
            }
        }
        Group { ListRow(if (goals.size > 1) "Goals this week" else goals[0].title ?: "", meta, onClick = onGoals, trailing = { Chevron() }) }
    }
}

// The Up next meeting has Prep (null in read-only mode), Open calendar and Notes in its More menu; a Today meeting about to start has Join.
@Composable
private fun MeetingRow(m: Row, now: Long, upNext: Boolean, onPrep: (() -> Unit)? = null, onNotes: (() -> Unit)? = null, onClick: () -> Unit) {
    val live = isLive(m, now)
    val soon = joinMinutes(m, now)
    val link = safeHref(m.str("calendar_url"))
    val uri = LocalUriHandler.current
    val meta = if (upNext) listOfNotNull(countdown(m, now), meetingMeta(m, now)).joinToString(" · ") else if (soon != null) "Starts in $soon min" else clock(m.startsAt!!)
    ListRow(m.title ?: "Meeting", meta, onClick = onClick, trailing = {
        if (live) Badge("Live", BadgeTone.Running)
        if (upNext) MoreButton { close ->
            if (onPrep != null && !isSolo(m)) MenuItem("Prep", "sparkle", { close(); onPrep() })
            if (link != null && m.id.startsWith("cal:")) MenuItem("Open calendar", "calendar", { close(); uri.openUri(link) })
            if (onNotes != null) MenuItem("Notes", "edit", { close(); onNotes() })
        }
        else if (!live && link != null && soon != null) Button("Join", { uri.openUri(link) }, icon = "device-camera-video", variant = ButtonVariant.Filled, size = ButtonSize.Sm)
    })
}

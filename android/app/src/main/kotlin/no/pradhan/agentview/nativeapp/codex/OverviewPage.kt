package no.pradhan.agentview.nativeapp.codex

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
import no.pradhan.agentview.nativeapp.app.waits
import no.pradhan.agentview.nativeapp.chat.AttachButton
import no.pradhan.agentview.nativeapp.chat.Tone2
import no.pradhan.agentview.nativeapp.chat.Dictation
import no.pradhan.agentview.nativeapp.chat.VoiceButton
import no.pradhan.agentview.nativeapp.chat.appendWord
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.askCodex
import no.pradhan.agentview.nativeapp.net.codexProfile
import no.pradhan.agentview.nativeapp.sessions.folderName
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.ChipTone
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.select

@Composable
fun AskBar(hub: Hub, st: CodexState, profile: String?) {
    val text by hub.codexDraft.collectAsState()
    val uploading by hub.codexUploads.collectAsState()
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    val guess = profile ?: picked ?: guessProfile(text, st.meetings, hub.codexProfile)
    val send = {
        val q = text.trim()
        if (q.isNotEmpty() && uploading == 0) {
            val p = guess
            picked = null
            hub.askCodex(askText(q, p, st.items.filter { !it.deleted && it.profile == p }, null, st.meetings.filter { it.profile == p }), p)
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
            AttachButton(hub, { n -> hub.codexUploads.update { it + n } }, choose = false) { path -> hub.setCodexDraft(appendWord(hub.codexDraft.value, "[Image: $path] ")) }
            TextField(text, hub::setCodexDraft, Modifier.weight(1f), placeholder = if (uploading > 0) "Uploading image…" else "Ask Codex about your day, or / for recipes", singleLine = true, pill = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }))
            val dictation = remember { Dictation() }
            VoiceButton({ spoken, final -> dictation.apply(text, text.length, spoken, final)?.let { hub.setCodexDraft(it.first) } }, { hub.notice.value = it })
            IconBtn("send", "Send", { send() }, enabled = text.isNotBlank() && uploading == 0, on = text.isNotBlank() && uploading == 0)
        }
    }
}

private const val TODAY_SHOWN = 7

private class OverviewData(val s: Split, val mt: Meetings, val needs: List<Need>, val needsTotal: Int, val today: Today, val rows: List<Triple<Long, Row?, Row?>>)

@Composable
private fun rememberOverviewData(hub: Hub, st: CodexState, profile: String?, now: Long): OverviewData {
    val s = remember(st.items, profile, now / 60_000) { split(st.items, profile, now) }
    val mt = remember(st.meetings, profile, now / 60_000) { meetingsOf(st.meetings, profile, now) }
    val hidden by hub.handled.collectAsState()
    val counts by hub.counts.collectAsState()
    val needsView = remember(st, profile, now / 60_000, hidden) { needsView(st, profile, now, hidden) }
    val needs = needsView.list
    val today = remember(st, profile, s, mt, needs) { overviewToday(s, mt.next, now, riskKeys(needs)) }
    val others = mt.today.filter { it != mt.next && (it.endsAt ?: it.startsAt!!) > now }
    val rows = remember(today, others) {
        today.late.map { Triple(it.at ?: 0L, null as Row?, it) } + (others.map { Triple(it.startsAt!!, it, null as Row?) } + today.todo.map { Triple(it.at ?: 0L, null as Row?, it) }).sortedBy { it.first }
    }
    return OverviewData(s, mt, needs, counts.needsYou, today, rows)
}

@Composable
fun OverviewPage(hub: Hub, st: CodexState, profile: String?, now: Long, actions: TaskActions, onOpen: (Row) -> Unit, onNeeds: () -> Unit, onGoals: () -> Unit, onAdd: () -> Unit, onMeeting: (Row) -> Unit) {
    val d = rememberOverviewData(hub, st, profile, now)
    val goals = remember(st.items, profile, now / 60_000) { goalsOf(st.items, now, profile) }
    var all by remember { mutableStateOf(false) }
    val live by hub.store.state.select { it.live }
    val running = remember(live) { runningChats(live) }
    val counts by hub.counts.collectAsState()
    LazyColumn(Modifier.fillMaxSize()) {
        item { UpNextSection(d, now, actions, onOpen, onNeeds, onAdd, onMeeting) }
        if (running.isNotEmpty()) runningSection(running, counts.running + counts.waiting) { hub.link.value = DeepLink(chat = it) }
        if (d.rows.isNotEmpty()) todaySection(d, now, actions, all, { all = true }, onOpen, onMeeting)
        if (goals.isNotEmpty()) goalsSection(st, goals, onGoals)
        item { androidx.compose.foundation.layout.Spacer(Modifier.padding(bottom = Tokens.fab + Tokens.sp20)) }
    }
}

@Composable
private fun UpNextSection(d: OverviewData, now: Long, actions: TaskActions, onOpen: (Row) -> Unit, onNeeds: () -> Unit, onAdd: () -> Unit, onMeeting: (Row) -> Unit) {
    val mt = d.mt
    val task = d.today.upNextTask
    if (mt.next != null || task != null) {
        SectionHeader("Up next")
        Group {
            mt.next?.let { MeetingRow(it, now, upNext = true) { onMeeting(it) } }
            if (mt.next != null && task != null) Hairline()
            task?.let { ListRow(it.title ?: "", it.at?.let { a -> clock(a) }, onClick = { onOpen(it) }, trailing = { Button("Done", { actions.done(it) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) }
        }
    } else {
        val later = d.s.later.filter { it.at != null }.minByOrNull { it.at!! }
        val hint = when {
            later != null && (mt.nextLater == null || later.at!! < mt.nextLater.startsAt!!) -> "Next: ${whenText(later.at!!, now)} ${later.title}"
            mt.nextLater != null -> "Next: ${whenText(mt.nextLater.startsAt!!, now)} ${mt.nextLater.title}"
            else -> "Nothing planned. Add a task to start the day."
        }
        EmptyState("Nothing today", hint, icon = "pass") { Button("New task", onAdd, variant = ButtonVariant.Filled, size = ButtonSize.Sm) }
    }
    if (d.needsTotal > 0) {
        Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Needs you", onClick = onNeeds, trailing = { Badge("${d.needsTotal}", BadgeTone.Quiet); Chevron() }) }
    }
}

// Chats that run or wait on me, waiting ones first.
fun runningChats(live: List<LiveChat>) = live.filter { c -> countChat(c, emptyMap()).let { it.waits || it.tone == Tone2.Running } }.sortedByDescending { countChat(it, emptyMap()).waits }

private fun LazyListScope.runningSection(chats: List<LiveChat>, count: Int, onOpen: (String) -> Unit) {
    item { SectionHeader("Running", count = "$count") }
    item {
        Group {
            chats.forEachIndexed { i, c ->
                if (i > 0) Hairline()
                val waits = countChat(c, emptyMap()).waits
                val doing = if (waits) "Waiting for you" else c.status.ifBlank { "Working" }
                ListRow(c.title.ifBlank { "Untitled" }, "${folderName(c.cwd)} · $doing", onClick = { onOpen(c.id) }, trailing = {
                    if (waits) Badge("Needs you", BadgeTone.Waiting) else Badge("Running", BadgeTone.Running)
                })
            }
        }
    }
}

private fun LazyListScope.todaySection(d: OverviewData, now: Long, actions: TaskActions, all: Boolean, onShowAll: () -> Unit, onOpen: (Row) -> Unit, onMeeting: (Row) -> Unit) {
    val rows = d.rows
    item { SectionHeader("Today", action = doneCount(d.s.doneToday.size, d.today.openCount)?.let { t -> { Badge(t, BadgeTone.Quiet) } }) }
    val shown = if (all) rows else rows.take(TODAY_SHOWN)
    item {
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

@Composable
private fun TodayTaskRow(r: Row, late: Boolean, actions: TaskActions, onOpen: (Row) -> Unit) {
    ListRow(
        r.title ?: "", if (late) null else r.at?.let { clock(it) },
        leading = { CheckCircle(false, "Mark ${r.title} done") { actions.done(r) } },
        trailing = {
            if (late) Badge("Late", BadgeTone.Failed)
            MoreButton { close ->
                MenuItem("Snooze to tomorrow", "clock", { close(); actions.snoozeLater(r) })
                MenuItem("Open", "arrow-right", { close(); onOpen(r) })
            }
        },
        onClick = { onOpen(r) },
    )
}

private fun LazyListScope.goalsSection(st: CodexState, goals: List<Row>, onGoals: () -> Unit) {
    item { SectionHeader("Goals this week") }
    item {
        Group {
            goals.forEachIndexed { i, g ->
                if (i > 0) Hairline()
                val p = goalProgress(st.items, g)
                ListRow(g.title ?: "", if (p.total > 0) "${p.done}/${p.total} done" else "No tasks yet", onClick = onGoals, trailing = { Chevron() })
            }
        }
    }
}

@Composable
private fun MeetingRow(m: Row, now: Long, upNext: Boolean, onClick: () -> Unit) {
    val live = isLive(m, now)
    val soon = joinMinutes(m, now)
    val meta = if (upNext) listOfNotNull(countdown(m, now), meetingMeta(m, now)).joinToString(" · ") else if (soon != null) "Starts in $soon min" else clock(m.startsAt!!)
    ListRow(m.title ?: "Meeting", meta, onClick = onClick, trailing = { if (live) Badge("Live", BadgeTone.Running) })
}

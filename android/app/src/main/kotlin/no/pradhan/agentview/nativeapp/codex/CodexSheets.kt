package no.pradhan.agentview.nativeapp.codex

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.codex.jobs.canRunNow
import no.pradhan.agentview.nativeapp.codex.jobs.runJobNow
import no.pradhan.agentview.nativeapp.codex.meetings.ActionMenuItems
import no.pradhan.agentview.nativeapp.codex.meetings.followUpText
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import no.pradhan.agentview.nativeapp.codex.wiki.agoText
import no.pradhan.agentview.nativeapp.sessions.segmentOf
import no.pradhan.agentview.nativeapp.net.Ask
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.codexProfile
import no.pradhan.agentview.nativeapp.app.linkTitle
import no.pradhan.agentview.nativeapp.app.parseTask
import no.pradhan.agentview.nativeapp.app.hideNeed
import no.pradhan.agentview.nativeapp.app.restoreNeed
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.ChipTone
import no.pradhan.agentview.nativeapp.ui.FieldLabel
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.SwipeLabel
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.agoShort
import no.pradhan.agentview.nativeapp.ui.DateDialog
import no.pradhan.agentview.nativeapp.ui.TimeDialog
import no.pradhan.agentview.nativeapp.ui.plural

private val PRIORITIES = listOf(0 to "None", 1 to "Low", 2 to "Medium", 3 to "High")

private fun dueLabel(at: Long?, now: Long): String {
    if (at == null) return "No due"
    val time = if (hourOf(at) != 0 || minuteOf(at) != 0) " ${clock(at)}" else ""
    return when (daysFrom(at, now)) { 0L -> "Today$time"; 1L -> "Tomorrow$time"; else -> dayHeading(at, now) + time }
}

// A day, then a time; Skip keeps the day without a time (09:00 on a later day, no due time today).
@Composable
fun DueDialog(initial: Long?, now: Long, onPick: (Long?) -> Unit, onDismiss: () -> Unit) {
    var day by remember { mutableStateOf<java.time.LocalDate?>(null) }
    val chosen = day
    if (chosen == null) {
        DateDialog(Instant.ofEpochMilli(initial ?: now).atZone(codexZone).toLocalDate(), "Next", "No due", { it?.let { d -> day = d } }, { onPick(null); onDismiss() }, onDismiss)
        return
    }
    TimeDialog(dayLabel(atHour(chosen, 12)), initial?.let(::hourOf) ?: MORNING, initial?.let(::minuteOf) ?: 0, "Set", "No time", { h, m -> onPick(atHour(chosen, h, m)); onDismiss() }, {
        val t = atHour(chosen, MORNING)
        onPick(if (dayStart(t) == dayStart(now)) null else t)
        onDismiss()
    }, onDismiss)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun EditorSheet(hub: Hub, row: Row, items: List<Row>, meetings: List<Row>, now: Long, actions: TaskActions, raiseWith: List<String>, from: Row?, onMeeting: (Row) -> Unit, onRaise: (String, String) -> Unit, onAsk: (Row) -> Unit, onChat: ((String?) -> String) -> Unit, onOpenChat: (String) -> Unit, onDismiss: () -> Unit) {
    var title by remember(row.key) { mutableStateOf(row.title ?: "") }
    var text by remember(row.key) { mutableStateOf(row.text ?: "") }
    var pickDue by remember { mutableStateOf(false) }
    var tag by remember { mutableStateOf("") }
    var tidying by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val clip = LocalClipboardManager.current
    val uri = LocalUriHandler.current
    val latest by androidx.compose.runtime.rememberUpdatedState(row)
    val commit = {
        val patch = mutableMapOf<String, Any?>()
        if (title.trim().isNotEmpty() && title.trim() != (latest.title ?: "")) patch["title"] = title.trim()
        if (text != (latest.text ?: "")) patch["text"] = text.trim().ifEmpty { null }
        if (patch.isNotEmpty()) actions.edit(latest, patch)
    }
    Sheet(onDismiss = { commit(); onDismiss() }, title = "Task", action = { IconBtn("close", "Close", { commit(); onDismiss() }) }) {
        Column(Modifier.imePadding().padding(vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
            FieldLabel("Title")
            TextField(title, { title = it }, placeholder = "Title", style = Type.title)
            FieldLabel("Notes")
            TextField(text, { text = it }, placeholder = "Notes", minLines = 3)
            NoteLinks(hub, text)
            Checklist(text, !hub.readOnly && (row.status == "open" || row.status == "done")) { text = it }
            val related = remember(items, meetings, row.key, row.title, row.people, now / 60_000) { relatedToTask(items, meetings, row, now) }
            if (related.isNotEmpty()) Column {
                SectionHeader("Related", "${related.size}")
                Group {
                    related.forEachIndexed { i, r ->
                        if (i > 0) Hairline()
                        if (r.table == "meetings") ListRow(r.title?.ifEmpty { null } ?: "Meeting", r.startsAt?.let(::dayLabel), leading = { AvIcon("record") }, onClick = { commit(); onDismiss(); onMeeting(r) })
                        else ListRow(r.title?.ifEmpty { null } ?: r.text?.ifEmpty { null } ?: "Slack", "Slack", leading = { AvIcon("comment-discussion") }, onClick = safeHref(r.sourceUrl)?.let { h -> { uri.openUri(h) } })
                    }
                }
            }
            FieldLabel("Due")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                val late = (row.at ?: Long.MAX_VALUE) < now && row.status == "open"
                Chip(dueLabel(row.at, now), { pickDue = true }, icon = if (late) "warning" else "calendar", on = row.at != null, late = late, quiet = row.at == null)
                if (row.at != null) Chip("Clear", { actions.due(row, null) })
                val skipAt = if (row.status == "open" && row.at != null && !hub.readOnly) skipTarget(row, now) else null
                if (skipAt != null) Chip("Skip · ${whenText(skipAt, now, true)}", { actions.change(row, mapOf("at" to skipAt) + unrollFor(skipAt, now), "Skipped · next ${whenText(skipAt, now)}") })
            }
            FieldLabel("Snooze")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                val free = remember(meetings, row.profile, now / 60_000) { freeTimes(meetings, row.profile, now) }
                free.forEach { (label, at) -> Chip("$label · ${whenText(at, now)}", { actions.snooze(row, at) }) }
                SNOOZES.forEach { s ->
                    val at = s.at(now, row.profile)
                    Chip("${s.label} · ${whenText(at, now)}", { actions.snooze(row, at) })
                }
            }
            FieldLabel("Priority")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                PRIORITIES.forEach { (p, label) -> Chip(label, { actions.edit(row, mapOf("priority" to p)) }, on = row.priority == p) }
            }
            if (row.status == "open") {
                FieldLabel("Repeat")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    val cadence = cadenceOf(text, row.at, now)
                    val at = row.at?.let { Instant.ofEpochMilli(it).atZone(codexZone) }
                    listOf(
                        "never" to "Never", "daily" to "Daily", "weekdays" to "Weekdays",
                        "weekly" to "Weekly" + (at?.let { " on ${WEEKDAYS[it.dayOfWeek.value % 7].replaceFirstChar { c -> c.uppercase() }}" } ?: ""),
                        "monthly" to "Monthly" + (at?.let { " on the ${it.dayOfMonth}" } ?: ""),
                    ).forEach { (c, label) ->
                        Chip(label, { if (c != cadence) text = withRule(text, if (c == "never") null else cadenceLine(c, row.at, now)) }, on = c == cadence)
                    }
                    if (cadence == "custom") Chip("Custom", null, on = true)
                }
                if (estimateMinutes(title) == null) {
                    FieldLabel("Estimate")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                        val suggested = remember(title, items, row.profile) { suggestEstimate(title, items.filter { !it.deleted && it.profile == row.profile }) }
                        if (suggested != null) Chip("~${minutesText(suggested)} suggested", { title = "${title.trim()} ~${minutesText(suggested)}" }, on = true)
                        listOf(15L, 30L, 60L, 120L).forEach { n -> Chip(minutesText(n), if (title.isBlank()) null else ({ title = "${title.trim()} ~${minutesText(n)}" })) }
                    }
                }
            }
            FieldLabel("Tags")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                val tags = tagList(row.tags)
                tags.forEach { t ->
                    Chip("#$t", { actions.edit(row, mapOf("tags" to tags.filter { it != t }.joinToString(" ").ifEmpty { null })) }, trailingIcon = "close", trailingLabel = "Remove #$t")
                }
            }
            fun addTag() {
                val t = tag.trim().trimStart('#').lowercase().replace(Regex("[^\\p{L}\\d_-]"), "")
                tag = ""
                if (t.isNotEmpty()) actions.edit(row, mapOf("tags" to (tagList(row.tags) + t).distinct().joinToString(" ")))
            }
            TextField(tag, { tag = it }, placeholder = "Add a tag", singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { addTag() }))
            val goals = remember(items, row.profile, now) { goalsOf(items, now, row.profile) }
            val linked = row.goal?.let { g -> items.firstOrNull { it.profile == row.profile && it.id == g && !it.deleted } }
            if (goals.isNotEmpty() || linked != null) {
                FieldLabel("Goal")
                var open by remember { mutableStateOf(false) }
                Column {
                    Chip(linked?.title ?: "No goal", { open = true }, on = linked != null, quiet = linked == null, trailingIcon = "chevron-down")
                    Menu(open, { open = false }) {
                        MenuItem("No goal", "close", { open = false; actions.edit(row, mapOf("goal" to null)) })
                        (if (linked != null && linked !in goals) listOf(linked) + goals else goals).forEach { g ->
                            MenuItem(g.title ?: "", "target", { open = false; actions.edit(row, mapOf("goal" to g.id)) })
                        }
                    }
                }
            }
            if (row.status == "open" || row.status == "done") {
                val spent = row.long("spent") ?: 0L
                FieldLabel(if (spent > 0) "Time spent · ${minutesText(spent)}" else "Time spent")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    listOf(15L, 30L, 60L).forEach { n -> Chip("+${minutesText(n)}", { actions.logTime(row, n) }) }
                }
            }
            TimeLogSection(row, actions, hub.readOnly)
            HistorySection(row, now)
            if (raiseWith.isNotEmpty()) {
                FieldLabel("Raise next time")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    raiseWith.forEach { p -> Chip("Raise with ${firstName(p)}", { onRaise(p, title) }) }
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                if (row.status == "done") Button("Not done", { actions.reopen(row) })
                else if (row.status == "open") Button("Done", { commit(); actions.done(row); onDismiss() }, variant = ButtonVariant.Filled)
                if (row.status == "note") Button("Make task", { commit(); actions.toTask(row); onDismiss() }, icon = "add")
                Button("Move to ${profileLabel(if (row.profile == WORK) PERSONAL else WORK)}", { actions.move(row, if (row.profile == WORK) PERSONAL else WORK) })
                if (from != null) Button("Open meeting", { commit(); onDismiss(); onMeeting(from) }, icon = "record")
                val chat = chatSessionOf(row.sourceUrl)
                if (chat != null) sourceLink(row).let { s -> Button(s.label, { commit(); onOpenChat(chat) }, icon = s.icon) }
                else safeHref(row.sourceUrl)?.let { href -> sourceLink(row).let { s -> Button(s.label, { uri.openUri(href) }, icon = s.icon) } }
                Button("Ask Claude", { commit(); onAsk(latest); onDismiss() })
                if (row.status == "open" && !hub.readOnly) Button(if (tidying) "Tidying…" else "Tidy", {
                    tidying = true
                    scope.launch {
                        try {
                            val p = hub.parseTask(listOf(title, text).filter { it.isNotBlank() }.joinToString("\n"), row.profile)
                            title = p.title
                            text = p.details ?: ""
                            if (p.at != null && latest.at == null) actions.edit(latest, mapOf("at" to p.at))
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            actions.say("Not tidied: ${e.message}")
                        } finally {
                            tidying = false
                        }
                    }
                }, variant = ButtonVariant.Plain, icon = "wand", enabled = !tidying)
                Button("Start a chat…", { commit(); onChat { repo -> taskChatPrompt(row.id, row.status, title, text, row.sourceUrl, repo != null && segmentOf(repo) == row.profile) }; onDismiss() })
                row.draft?.takeIf { it.isNotBlank() }?.let { d -> Button("Copy draft", { clip.setText(AnnotatedString(d)); actions.say("Draft copied") }, icon = "copy") }
                Button("Delete", { actions.delete(row); onDismiss() }, variant = ButtonVariant.Danger)
            }
        }
    }
    if (pickDue) DueDialog(row.at, now, { actions.due(row, it) }, { pickDue = false })
}

// The http(s) links in the notes as typed (web Links in TaskDraft.tsx): the page title, else the domain; a tap opens the browser.
@Composable
private fun NoteLinks(hub: Hub, text: String) {
    val urls = remember(text) { linksIn(text, Int.MAX_VALUE) }
    var all by remember { mutableStateOf(false) }
    if (urls.isEmpty()) return
    val uri = LocalUriHandler.current
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
        FieldLabel("Links")
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Tokens.shapeLg)).background(av.groupCard)) {
            (if (all) urls else urls.take(LINK_LIMIT)).forEachIndexed { i, u ->
                key(u) {
                    if (i > 0) Hairline()
                    val title by produceState<String?>(null, u) { delay(500); value = hub.linkTitle(u) }
                    ListRow(title ?: linkDomain(u), if (title != null) linkDomain(u) else linkPath(u).ifEmpty { null }, trailing = { AvIcon("link-external", tint = av.fgMuted) }, onClick = { uri.openUri(u) })
                }
            }
        }
        if (!all && urls.size > LINK_LIMIT) Button("Show all ${urls.size}", { all = true }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    }
}

// The "- [ ]" lines of the notes as rows that tick on a tap; both change the sheet's notes, which the sheet saves on close.
@Composable
private fun Checklist(text: String, canAdd: Boolean, onText: (String) -> Unit) {
    val checks = remember(text) { checkItems(text) }
    var label by remember { mutableStateOf("") }
    Column {
        if (checks.isNotEmpty()) {
            SectionHeader("Checklist", "${checks.count { it.done }} of ${checks.size}")
            Group {
                checks.forEachIndexed { i, c ->
                    if (i > 0) Hairline()
                    ListRow(c.label, leading = { CheckCircle(c.done, "Tick ${c.label}") { onText(toggleCheck(text, i)) } }, strike = c.done)
                }
            }
        }
        if (canAdd) TextField(label, { label = it }, placeholder = "Add subtask", singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { onText(addCheck(text, label)); label = "" }))
    }
}

// Quick capture: "call the bank tomorrow 9 #home" becomes a task due tomorrow 09:00 tagged home; the sheet stays open to add more.
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AddSheet(hub: Hub, profile: String?, items: List<Row>, goal: String?, now: Long, onDismiss: () -> Unit, onAdded: (String) -> Unit) {
    var title by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var due by remember { mutableStateOf<Long?>(null) }
    var picked by remember { mutableStateOf(false) }
    var priority by remember { mutableStateOf(0) }
    var target by remember { mutableStateOf(profile ?: hub.codexProfile) }
    var goalId by remember { mutableStateOf(goal) }
    val linked = goalToLink(items, goalId, now)
    var pickDue by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val parsed = remember(title, picked, due) { parseCapture(title, if (picked) due else null, picked, now) }
    val add = {
        val c = parsed
        if (c.title.isNotEmpty()) {
            val body = if (c.repeat != null) withRule(notes.trim(), c.repeat) else notes.trim()
            val extra = buildMap<String, Any?> { if (priority > 0) put("priority", priority); if (c.tags.isNotEmpty()) put("tags", c.tags.joinToString(" ")); if (linked != null) put("goal", linked.id) }
            if (hub.codex.capture(if (body.isNotEmpty()) "${c.title}\n$body" else c.title, "open", linked?.profile ?: target, c.at, extra) != null) {
                if (profile == null && linked == null) hub.codexProfile = target
                onAdded(c.title + (c.at?.let { " · ${whenText(it, now)}" } ?: ""))
                title = ""; notes = ""; due = null; picked = false; priority = 0
            }
        }
    }
    Sheet(onDismiss, "New task") {
        Column(Modifier.imePadding().padding(vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
            TextField(title, { title = it }, Modifier.focusRequester(focus), placeholder = "What would you like to do?", singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { add() }))
            TextField(notes, { notes = it }, placeholder = "Description", minLines = 2)
            val hint = listOfNotNull(parsed.at?.let { "Due ${whenText(it, now)}" }, parsed.repeat?.substringAfter("Repeats: "), parsed.tags.takeIf { it.isNotEmpty() }?.joinToString(" ") { "#$it" }).joinToString(" · ")
            if (hint.isNotEmpty()) Text(hint, style = Type.subheadline, color = av.fgMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
                Chip(if (picked) dueLabel(due, now) else "Date", { pickDue = true }, icon = "calendar", on = picked, quiet = !picked)
                Chip("Priority: ${priorityLabel(priority)}", { priority = (priority + 3) % 4 }, on = priority > 0)
                if (linked != null) Chip("Goal: ${linked.title}", { goalId = null }, icon = "target", on = true, trailingIcon = "close", trailingLabel = "Remove goal")
                else if (profile == null) Chip(profileLabel(target), { target = if (target == WORK) PERSONAL else WORK }, tone = if (target == WORK) ChipTone.Work else ChipTone.Personal)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button("Add task", { add() }, variant = ButtonVariant.Filled, icon = "send", enabled = parsed.title.isNotEmpty())
            }
        }
    }
    if (pickDue) DueDialog(due, now, { due = it; picked = true }, { pickDue = false })
}

class Capture(val title: String, val at: Long?, val tags: List<String>, val repeat: String?)

// How the add sheet reads a typed task (web quickAdd.ts parseCapture): a picked date wins, else a "every monday 9" rule, else a time in the text; then the estimate moves to the end of the title.
fun parseCapture(typed: String, pickedAt: Long?, picked: Boolean, now: Long): Capture {
    val t = typed.trim()
    val (plain, tags) = takeTags(t)
    val rep = if (picked) null else parseRepeat(plain, now)
    val w = if (picked || rep != null) null else parseWhen(plain, now)
    val at = if (picked) pickedAt else rep?.at ?: w?.at
    val name = if (rep != null) rep.title else stripWhen(plain, w).ifEmpty { plain }
    return Capture(if (t.isEmpty()) "" else withEstimate(name.ifEmpty { t }), at, tags, rep?.text)
}

@Composable
fun NeedsSheet(needs: List<Need>, queue: List<Row>, ignored: List<Ignored>, now: Long, actions: TaskActions, replies: ReplyOps, hub: Hub, onOpen: (Row) -> Unit, onAsk: (Row) -> Unit, onReview: () -> Unit, onPerson: (String) -> Unit, onNotes: (Row) -> Unit, onJob: (Row) -> Unit, onDismiss: () -> Unit) {
    var all by remember { mutableStateOf(setOf<String>()) }
    var onlyStale by remember { mutableStateOf(false) }
    val old = staleAsks(queue, now)
    val filtered = onlyStale && old.isNotEmpty()
    LaunchedEffect(onlyStale, old.size) { if (onlyStale && old.isEmpty()) onlyStale = false }
    LaunchedEffect(needs.size, queue.size) { if (needs.isEmpty() && queue.isEmpty()) onDismiss() }
    Sheet(onDismiss, "Needs you", padded = false) {
        val groups = listOf("Tasks" to needs.filter { it.isTask }, "Asks" to needs.filter { !it.isTask }).filter { it.second.isNotEmpty() }
        groups.forEach { (label, rows) ->
            SectionHeader(label, rows.size.toString())
            val shown = if (label in all) rows else rows.take(NEEDS_CAP)
            Group {
                shown.forEachIndexed { i, n ->
                    if (i > 0) Hairline()
                    key(n.keys.joinToString()) { NeedRow(n, now, actions, hub, onOpen, { onlyStale = true }, onReview, onPerson, onNotes, onJob) }
                }
                if (shown.size < rows.size) { Hairline(); ListRow("Show all ${rows.size}", onClick = { all = all + label }) }
            }
        }
        ReplySection(if (filtered) old else queue, filtered, { onlyStale = false }, now, actions, replies, onOpen, onAsk)
        if (!filtered && ignored.isNotEmpty()) IgnoredSection(ignored)
    }
}

// web TaskTimeLog: each focus session newest first with a Remove that takes its minutes off spent, then the time added by hand.
@Composable
private fun TimeLogSection(row: Row, actions: TaskActions, readOnly: Boolean) {
    var open by remember { mutableStateOf(false) }
    val sessions = parseLog(row.str("time_log")).sortedByDescending { it.at }
    val byHand = (row.long("spent") ?: 0L) - sessions.sumOf { it.min }
    if (sessions.isEmpty() && byHand <= 0) return
    SectionHeader("Time log", sessions.size.takeIf { it > 0 }?.toString(), open, { open = !open })
    if (!open) return
    Group {
        sessions.forEachIndexed { i, s ->
            if (i > 0) Hairline()
            ListRow("${weekdayDate(s.at)} ${clock(s.at)}", minutesText(s.min), trailing = if (readOnly) null else ({
                IconBtn("close", "Remove ${minutesText(s.min)}", { actions.change(row, removeSession(row.str("time_log"), row.long("spent"), s.id), "Removed ${minutesText(s.min)}") })
            }))
        }
    }
    if (byHand > 0) Text("Earlier or added by hand: ${minutesText(byHand)}", Modifier.padding(horizontal = Tokens.listPad), style = Type.footnote, color = av.fgMuted)
}

// web TaskEditor History: when the status, due date and assignee last changed.
@Composable
private fun HistorySection(row: Row, now: Long) {
    var open by remember { mutableStateOf(false) }
    val history = historyOf(row)
    if (history.isEmpty()) return
    SectionHeader("History", history.size.toString(), open, { open = !open })
    if (!open) return
    Group {
        history.forEachIndexed { i, h ->
            if (i > 0) Hairline()
            ListRow(h.title, historyTime(h.at, now))
        }
    }
}

@Composable
private fun IgnoredSection(list: List<Ignored>) {
    val uri = LocalUriHandler.current
    var open by remember { mutableStateOf(false) }
    var all by remember { mutableStateOf(false) }
    SectionHeader("Ignored today", list.size.toString(), open, { open = !open })
    if (!open) return
    Group {
        (if (all) list else list.take(NEEDS_CAP)).forEachIndexed { i, e ->
            if (i > 0) Hairline()
            ListRow(e.from, e.gist, lines = 1, metaLines = 1, trailing = { safeHref(e.url)?.let { href -> IconBtn("link-external", "Open", { uri.openUri(href) }) } })
        }
        if (!all && list.size > NEEDS_CAP) { Hairline(); ListRow("Show all ${list.size}", onClick = { all = true }) }
    }
}

@Composable
private fun NeedRow(n: Need, now: Long, actions: TaskActions, hub: Hub, onOpen: (Row) -> Unit, onStale: () -> Unit, onReview: () -> Unit, onPerson: (String) -> Unit, onNotes: (Row) -> Unit, onJob: (Row) -> Unit) {
    when (n) {
        is Need.FailedJobRow -> ListRow("${n.job.str("name")?.ifEmpty { null } ?: "Job"} failed", listOfNotNull(firstLine(n.run.str("output")).ifEmpty { null }, n.run.long("finished_at")?.let { agoText(it, now) }).joinToString(" · "), onClick = { onJob(n.job) },
            trailing = { Button("Run again", { runJobNow(hub, actions, n.job) }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm, enabled = canRunNow(n.job, listOf(n.run), now)) })
        is Need.StaleAsks -> ListRow("${plural(n.count, "ask")} older than $STALE_DAYS days", "oldest ${agoShort(n.oldest, now)}", onClick = onStale)
        is Need.Wiki -> ListRow("${n.count} wiki ${if (n.count == 1) "claim waits" else "claims wait"} for you", "Review all", onClick = onReview,
            trailing = { Button("Review", onReview, variant = ButtonVariant.Tinted, size = ButtonSize.Sm) })
        is Need.Overdue -> ListRow(n.row.title ?: "", n.row.at?.let { "Overdue · due ${whenText(it, now)}" }, leading = { CheckCircle(false, "Done") { actions.done(n.row) } },
            trailing = { SnoozeMore(n.row, actions) }, onClick = { onOpen(n.row) })
        is Need.OverdueAll -> ListRow("${n.rows.size} overdue", "Move them all to today", trailing = { Button("Move all to today", { actions.moveToToday(n.rows) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })
        is Need.JustEnded -> {
            val clip = LocalClipboardManager.current
            ListRow(n.row.title ?: "", "Just ended · ${n.meeting.title}", leading = { CheckCircle(false, "Done") { actions.done(n.row) } }, onClick = { onOpen(n.row) },
                trailing = {
                    MoreButton { close ->
                        ActionMenuItems(n.row, n.meeting, now, actions, hub.readOnly, close, onOpen) {
                            MenuItem("Copy follow-up", "mail", { close(); clip.setText(AnnotatedString(followUpText(n.meeting, n.actions))); actions.say("Follow-up copied") })
                            MenuItem("Notes", "edit", { close(); onNotes(n.meeting) })
                        }
                    }
                })
        }
        is Need.Ask -> DismissSwipe({ actions.dismiss(n.row) }) {
            ListRow(n.row.title ?: "", listOfNotNull(n.row.people, firstLine(n.row.text).ifEmpty { null }).joinToString(" · "), onClick = { onOpen(n.row) },
                trailing = { Button("Add", { actions.accept(n.row) }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm) },
                menu = { close ->
                    MenuItem("Open", "arrow-right", { close(); onOpen(n.row) })
                    MenuItem("Nothing asked", "note", { close(); actions.toNote(n.row) }, enabled = !hub.readOnly)
                    MenuItem("Dismiss", "close", { close(); actions.dismiss(n.row) })
                })
        }
        is Need.Risk -> ListRow(n.row.title ?: "", "At risk · due ${whenText(n.due, now)} · ${minutesText(n.short)} short", leading = { CheckCircle(false, "Done") { actions.done(n.row) } },
            trailing = { SnoozeMore(n.row, actions) }, onClick = { onOpen(n.row) })
        is Need.Slack -> NeedCard(n.bullet.title, "Slack" + (n.bullet.why.takeIf { it.isNotEmpty() }?.let { " · $it" } ?: ""), n.bullet.url, { dismissNeed(hub, actions, n) }, null, !hub.readOnly, { noteNeed(hub, actions, listOf(n.bullet.title, n.bullet.why).filter { it.isNotEmpty() }.joinToString(": "), n.bullet.url, n.profile, n) }) {
            taskNeed(hub, actions, listOf(n.bullet.title, n.bullet.why).filter { it.isNotEmpty() }.joinToString(": "), n.profile, mapOf("text" to n.bullet.url), n)
        }
        is Need.Dm -> NeedCard(n.chat.str("name") ?: "DM", listOfNotNull(listOfNotNull("DM", n.chat.long("last_at")?.let { agoText(it, now) }).joinToString(" · "), n.chat.str("summary")?.ifEmpty { null }).joinToString("\n"), n.chat.str("url"), { dismissNeed(hub, actions, n) }, n.chat.str("name")?.let { name -> { onPerson(name) } }, !hub.readOnly, { noteNeed(hub, actions, listOfNotNull(n.chat.str("name") ?: "DM", n.chat.str("summary")?.ifEmpty { null }).joinToString(": "), n.chat.str("url"), n.chat.profile, n) }) {
            taskNeed(hub, actions, "Reply to ${n.chat.str("name") ?: "DM"}", n.chat.profile, mapOf("text" to listOfNotNull(n.chat.str("summary"), n.chat.str("url")).joinToString("\n\n").ifEmpty { null }, "source" to "slack", "people" to "${n.chat.str("name")} · DM"), n)
        }
    }
}

private fun dismissNeed(hub: Hub, actions: TaskActions, n: Need) {
    if (hub.hideNeed(n)) actions.undoable("Dismissed") { hub.restoreNeed(n) }
}

private fun taskNeed(hub: Hub, actions: TaskActions, title: String, profile: String, fields: Map<String, Any?>, n: Need) {
    val made = hub.codex.capture(title, "open", profile, null, fields) ?: return
    hub.hideNeed(n)
    actions.undoable("Added to Tasks") { hub.codex.update(made, mapOf("deleted" to true)); hub.restoreNeed(n) }
}

@Composable
private fun SnoozeMore(row: Row, actions: TaskActions) {
    MoreButton { close -> MenuItem("Snooze to next 09:00", "clock", { close(); actions.snoozeLater(row) }) }
}

private fun noteNeed(hub: Hub, actions: TaskActions, title: String, text: String?, profile: String, n: Need) {
    val made = hub.codex.capture(title, "note", profile, null, mapOf("text" to text))
    if (made == null) { actions.say(NOTE_FAILED); return }
    hub.hideNeed(n)
    actions.undoable(NOTED) { hub.codex.update(made, mapOf("deleted" to true)); hub.restoreNeed(n) }
}

// A left swipe dismisses; the row leaves with the data, so the box never settles open.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DismissSwipe(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    val current by rememberUpdatedState(onDismiss)
    val state = rememberSwipeToDismissBoxState(confirmValueChange = { v -> if (v == SwipeToDismissBoxValue.EndToStart) current(); false })
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            if (state.dismissDirection == SwipeToDismissBoxValue.EndToStart) SwipeLabel(av.warnContainer, "close", "Dismiss", av.onWarnContainer)
            else SwipeLabel(av.groupCard)
        },
        content = { Box(Modifier.background(av.groupCard)) { content() } },
    )
}

@Composable
private fun NeedCard(title: String, meta: String, url: String?, onDismiss: () -> Unit, onOpen: (() -> Unit)?, canNote: Boolean, onNote: () -> Unit, onTask: () -> Unit) {
    val uri = LocalUriHandler.current
    DismissSwipe(onDismiss) {
        ListRow(title, meta, metaLines = 5, onClick = onOpen, menu = { close ->
            MenuItem("Make task", "add", { close(); onTask() })
            safeHref(url)?.let { href -> MenuItem("Open in Slack", "link", { close(); uri.openUri(href) }) }
            MenuItem("Nothing asked", "note", { close(); onNote() }, enabled = canNote)
            MenuItem("Dismiss", "close", { close(); onDismiss() })
        })
    }
}

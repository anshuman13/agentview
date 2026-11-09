package no.pradhan.agentview.nativeapp.codex

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.ImeAction
import java.time.Instant
import java.time.ZoneOffset
import no.pradhan.agentview.nativeapp.app.icon
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.chat.firstLine
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import no.pradhan.agentview.nativeapp.codex.wiki.agoText
import no.pradhan.agentview.nativeapp.net.Ask
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.codexProfile
import no.pradhan.agentview.nativeapp.net.hideNeed
import no.pradhan.agentview.nativeapp.sessions.items
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
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.color
import no.pradhan.agentview.nativeapp.workspace.agoShort

private val PRIORITIES = listOf(0 to "None", 1 to "Low", 2 to "Medium", 3 to "High")

private fun dueLabel(at: Long?, now: Long): String {
    if (at == null) return "No due"
    val time = if (hourOf(at) != 0 || minuteOf(at) != 0) " ${clock(at)}" else ""
    return when (daysFrom(at, now)) { 0L -> "Today$time"; 1L -> "Tomorrow$time"; else -> dayHeading(at, now) + time }
}

// A day, then a time; Skip keeps the day without a time (09:00 on a later day, no due time today).
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DueDialog(initial: Long?, now: Long, onPick: (Long?) -> Unit, onDismiss: () -> Unit) {
    val picker = rememberDatePickerState(initialSelectedDateMillis = (initial ?: now).let { t -> Instant.ofEpochMilli(t).atZone(codexZone).toLocalDate().atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() })
    var day by remember { mutableStateOf<java.time.LocalDate?>(null) }
    val chosen = day
    if (chosen == null) {
        androidx.compose.material3.DatePickerDialog(
            onDismissRequest = onDismiss,
            confirmButton = { Button("Next", { picker.selectedDateMillis?.let { day = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() } }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) },
            dismissButton = { Button("No due", { onPick(null); onDismiss() }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) },
        ) { DatePicker(picker) }
        return
    }
    val time = rememberTimePickerState(initialHour = initial?.let(::hourOf) ?: MORNING, initialMinute = initial?.let(::minuteOf) ?: 0, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = av.raised,
        shape = RoundedCornerShape(Tokens.shapeLg),
        title = { Text(dayLabel(atHour(chosen, 12)), style = Type.headline, color = av.fg) },
        text = { TimePicker(time) },
        confirmButton = { Button("Set", { onPick(atHour(chosen, time.hour, time.minute)); onDismiss() }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) },
        dismissButton = {
            Button("No time", {
                val t = atHour(chosen, MORNING)
                onPick(if (dayStart(t) == dayStart(now)) null else t)
                onDismiss()
            }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun EditorSheet(row: Row, items: List<Row>, now: Long, actions: TaskActions, raiseWith: List<String>, onRaise: (String, String) -> Unit, onDismiss: () -> Unit) {
    var title by remember(row.id) { mutableStateOf(row.title ?: "") }
    var text by remember(row.id) { mutableStateOf(row.text ?: "") }
    var pickDue by remember { mutableStateOf(false) }
    var tag by remember { mutableStateOf("") }
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
            FieldLabel("Due")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                val late = (row.at ?: Long.MAX_VALUE) < now && row.status == "open"
                Chip(dueLabel(row.at, now), { pickDue = true }, icon = if (late) "warning" else "calendar", on = row.at != null, late = late, quiet = row.at == null)
                if (row.at != null) Chip("Clear", { actions.due(row, null) })
            }
            FieldLabel("Snooze")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                SNOOZES.forEach { s ->
                    val at = s.at(now, row.profile)
                    Chip("${s.label} · ${whenText(at, now)}", { actions.snooze(row, at) })
                }
            }
            FieldLabel("Priority")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                PRIORITIES.forEach { (p, label) -> Chip(label, { actions.edit(row, mapOf("priority" to p)) }, on = row.priority == p) }
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
            if (raiseWith.isNotEmpty()) {
                FieldLabel("Raise next time")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    raiseWith.forEach { p -> Chip("Raise with ${firstName(p)}", { onRaise(p, title) }) }
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                if (row.status == "done") Button("Not done", { actions.reopen(row) })
                else if (row.status == "open") Button("Done", { commit(); actions.done(row); onDismiss() }, variant = ButtonVariant.Filled)
                Button("Move to ${profileLabel(if (row.profile == WORK) PERSONAL else WORK)}", { actions.move(row, if (row.profile == WORK) PERSONAL else WORK) })
                Button("Delete", { actions.delete(row); onDismiss() }, variant = ButtonVariant.Danger)
            }
        }
    }
    if (pickDue) DueDialog(row.at, now, { actions.due(row, it) }, { pickDue = false })
}

// Quick capture: "call the bank tomorrow 9 #home" becomes a task due tomorrow 09:00 tagged home; the sheet stays open to add more.
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AddSheet(hub: Hub, profile: String?, now: Long, onDismiss: () -> Unit, onAdded: (String) -> Unit) {
    var title by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var due by remember { mutableStateOf<Long?>(null) }
    var picked by remember { mutableStateOf(false) }
    var priority by remember { mutableStateOf(0) }
    var target by remember { mutableStateOf(profile ?: hub.codexProfile) }
    var pickDue by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val parsed = remember(title, picked, due) { parseCapture(title, if (picked) due else null, picked, now) }
    val add = {
        val c = parsed
        if (c.title.isNotEmpty()) {
            val body = if (c.repeat != null) withRule(notes.trim(), c.repeat) else notes.trim()
            val extra = buildMap<String, Any?> { if (priority > 0) put("priority", priority); if (c.tags.isNotEmpty()) put("tags", c.tags.joinToString(" ")) }
            if (hub.codex.capture(if (body.isNotEmpty()) "${c.title}\n$body" else c.title, "open", target, c.at, extra) != null) {
                if (profile == null) hub.codexProfile = target
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
                if (profile == null) Chip(profileLabel(target), { target = if (target == WORK) PERSONAL else WORK }, tone = if (target == WORK) ChipTone.Work else ChipTone.Personal)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button("Add task", { add() }, variant = ButtonVariant.Filled, icon = "send", enabled = parsed.title.isNotEmpty())
            }
        }
    }
    if (pickDue) DueDialog(due, now, { due = it; picked = true }, { pickDue = false })
}

class Capture(val title: String, val at: Long?, val tags: List<String>, val repeat: String?)

// How the add sheet reads a typed task: a picked date wins, else a "every monday 9" rule, else a time in the text.
fun parseCapture(typed: String, pickedAt: Long?, picked: Boolean, now: Long): Capture {
    val t = typed.trim()
    val (plain, tags) = takeTags(t)
    val rep = if (picked) null else parseRepeat(plain, now)
    val w = if (picked || rep != null) null else parseWhen(plain, now)
    val at = if (picked) pickedAt else rep?.at ?: w?.at
    val name = if (rep != null) rep.title else stripWhen(plain, w).ifEmpty { plain }
    return Capture(if (t.isEmpty()) "" else name.ifEmpty { t }, at, tags, rep?.text)
}

@Composable
fun NeedsSheet(needs: List<Need>, queue: List<Row>, now: Long, actions: TaskActions, replies: ReplyOps, hub: Hub, onOpen: (Row) -> Unit, onReview: () -> Unit, onPerson: (String) -> Unit, onDismiss: () -> Unit) {
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
                    NeedRow(n, now, actions, hub, onOpen, { onlyStale = true }, onReview, onPerson)
                }
                if (shown.size < rows.size) { Hairline(); ListRow("Show all ${rows.size}", onClick = { all = all + label }) }
            }
        }
        ReplySection(if (filtered) old else queue, filtered, { onlyStale = false }, now, actions, replies, onOpen)
    }
}

@Composable
private fun NeedRow(n: Need, now: Long, actions: TaskActions, hub: Hub, onOpen: (Row) -> Unit, onStale: () -> Unit, onReview: () -> Unit, onPerson: (String) -> Unit) {
    when (n) {
        is Need.StaleAsks -> ListRow("${n.count} ${if (n.count == 1) "ask" else "asks"} older than $STALE_DAYS days", "oldest ${agoShort(n.oldest, now)}", onClick = onStale)
        is Need.Wiki -> ListRow("${n.count} wiki ${if (n.count == 1) "claim waits" else "claims wait"} for you", onClick = onReview)
        is Need.Overdue -> ListRow(n.row.title ?: "", n.row.at?.let { "Overdue · due ${whenText(it, now)}" }, leading = { CheckCircle(false, "Done") { actions.done(n.row) } },
            trailing = { MoreButton { close -> MenuItem("Snooze to next 09:00", "clock", { close(); actions.snoozeLater(n.row) }) } }, onClick = { onOpen(n.row) })
        is Need.OverdueAll -> ListRow("${n.rows.size} overdue", "Move them all to today", trailing = { Button("Move to today", { actions.moveToToday(n.rows) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })
        is Need.JustEnded -> ListRow(n.row.title ?: "", "Just ended · ${n.meeting.title}", leading = { CheckCircle(false, "Done") { actions.done(n.row) } }, onClick = { onOpen(n.row) })
        is Need.Ask -> ListRow(n.row.title ?: "", listOfNotNull(n.row.people, firstLine(n.row.text).ifEmpty { null }).joinToString(" · ").atWord(), metaLines = 4, onClick = { onOpen(n.row) },
            below = { Button("Add", { actions.accept(n.row) }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm); Button("Dismiss", { actions.dismiss(n.row) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })
        is Need.Risk -> ListRow(n.row.title ?: "", "At risk · due ${whenText(n.due, now)} · ${minutesText(n.short)} short", leading = { CheckCircle(false, "Done") { actions.done(n.row) } }, onClick = { onOpen(n.row) })
        is Need.Slack -> NeedCard(n.bullet.title, "Slack" + (n.bullet.why.takeIf { it.isNotEmpty() }?.let { " · $it" } ?: ""), n.bullet.url, { hub.hideNeed(slackKey(n.bullet)) }, null) {
            if (hub.codex.capture(listOf(n.bullet.title, n.bullet.why).filter { it.isNotEmpty() }.joinToString(": "), "open", n.profile, null, mapOf("text" to n.bullet.url)) != null) hub.hideNeed(slackKey(n.bullet))
        }
        is Need.Dm -> NeedCard(n.chat.str("name") ?: "DM", listOfNotNull("DM", n.chat.long("last_at")?.let { agoText(it, now) }, n.chat.str("summary")?.ifEmpty { null }).joinToString(" · "), n.chat.str("url"), { hub.hideNeed(waitKey(n.chat)) }, n.chat.str("name")?.let { name -> { onPerson(name) } }) {
            if (hub.codex.capture("Reply to ${n.chat.str("name") ?: "DM"}", "open", n.chat.profile, null, mapOf("text" to listOfNotNull(n.chat.str("summary"), n.chat.str("url")).joinToString("\n\n").ifEmpty { null }, "source" to "slack", "people" to "${n.chat.str("name")} · DM")) != null) hub.hideNeed(waitKey(n.chat))
        }
    }
}

private fun String.atWord(max: Int = 110) = if (length <= max) this else substring(0, max).substringBeforeLast(' ').trimEnd(',', '.', ';', ':') + "…"

@Composable
private fun NeedCard(title: String, meta: String, url: String?, onDismiss: () -> Unit, onOpen: (() -> Unit)?, onTask: () -> Unit) {
    val uri = LocalUriHandler.current
    ListRow(title, meta.atWord(), metaLines = 4, onClick = onOpen, below = {
        Button("Make task", onTask, variant = ButtonVariant.Tinted, size = ButtonSize.Sm)
        Button("Dismiss", onDismiss, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        safeHref(url)?.let { href -> MoreButton { close -> MenuItem("Open in Slack", "link", { close(); uri.openUri(href) }) } }
    })
}

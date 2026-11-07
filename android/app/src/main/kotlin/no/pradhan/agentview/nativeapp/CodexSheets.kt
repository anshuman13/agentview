package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneOffset

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
            confirmButton = { TextButton(onClick = { picker.selectedDateMillis?.let { day = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() } }) { Text("Next") } },
            dismissButton = { TextButton(onClick = { onPick(null); onDismiss() }) { Text("No due") } },
        ) { DatePicker(picker) }
        return
    }
    val time = rememberTimePickerState(initialHour = initial?.let(::hourOf) ?: MORNING, initialMinute = initial?.let(::minuteOf) ?: 0, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(dayLabel(atHour(chosen, 12))) },
        text = { TimePicker(time) },
        confirmButton = { TextButton(onClick = { onPick(atHour(chosen, time.hour, time.minute)); onDismiss() }) { Text("Set") } },
        dismissButton = {
            TextButton(onClick = {
                val t = atHour(chosen, MORNING)
                onPick(if (dayStart(t) == dayStart(now)) null else t)
                onDismiss()
            }) { Text("No time") }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun EditorSheet(row: Row, items: List<Row>, now: Long, actions: TaskActions, onDismiss: () -> Unit) {
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
    ModalBottomSheet(onDismissRequest = { commit(); onDismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding().padding(horizontal = Sp.s8, vertical = Sp.s4), verticalArrangement = Arrangement.spacedBy(Sp.s6)) {
            OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("Title") })
            OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), label = { Text("Notes") }, minLines = 3)
            Text("Due", style = MaterialTheme.typography.labelLarge, color = av.fgMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Sp.s4)) {
                AssistChip(onClick = { pickDue = true }, label = { Text(dueLabel(row.at, now)) }, leadingIcon = { Icon(Icons.Filled.DateRange, null) })
                if (row.at != null) AssistChip(onClick = { actions.due(row, null) }, label = { Text("Clear") })
            }
            Text("Snooze", style = MaterialTheme.typography.labelLarge, color = av.fgMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Sp.s4)) {
                SNOOZES.forEach { s ->
                    val at = s.at(now, row.profile)
                    AssistChip(onClick = { actions.snooze(row, at) }, label = { Text("${s.label} · ${whenText(at, now)}") })
                }
            }
            Text("Priority", style = MaterialTheme.typography.labelLarge, color = av.fgMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Sp.s4)) {
                PRIORITIES.forEach { (p, label) -> FilterChip(row.priority == p, { actions.edit(row, mapOf("priority" to p)) }, { Text(label) }) }
            }
            Text("Tags", style = MaterialTheme.typography.labelLarge, color = av.fgMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Sp.s4)) {
                val tags = tagList(row.tags)
                tags.forEach { t ->
                    AssistChip(onClick = { actions.edit(row, mapOf("tags" to tags.filter { it != t }.joinToString(" ").ifEmpty { null })) }, label = { Text("#$t") }, trailingIcon = { Icon(Icons.Filled.Close, "Remove #$t", Modifier.padding(0.dp)) })
                }
            }
            fun addTag() {
                val t = tag.trim().trimStart('#').lowercase().replace(Regex("[^\\p{L}\\d_-]"), "")
                tag = ""
                if (t.isNotEmpty()) actions.edit(row, mapOf("tags" to (tagList(row.tags) + t).distinct().joinToString(" ")))
            }
            OutlinedTextField(tag, { tag = it }, Modifier.fillMaxWidth(), label = { Text("Add a tag") }, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { addTag() }))
            val goals = remember(items, row.profile, now) { goalsOf(items, now, row.profile) }
            val linked = row.goal?.let { g -> items.firstOrNull { it.profile == row.profile && it.id == g && !it.deleted } }
            if (goals.isNotEmpty() || linked != null) {
                Text("Goal", style = MaterialTheme.typography.labelLarge, color = av.fgMuted)
                var open by remember { mutableStateOf(false) }
                Column {
                    OutlinedButton(onClick = { open = true }) { Text(linked?.title ?: "No goal") }
                    DropdownMenu(open, { open = false }) {
                        DropdownMenuItem(text = { Text("No goal") }, onClick = { open = false; actions.edit(row, mapOf("goal" to null)) })
                        (if (linked != null && linked !in goals) listOf(linked) + goals else goals).forEach { g ->
                            DropdownMenuItem(text = { Text(g.title ?: "") }, onClick = { open = false; actions.edit(row, mapOf("goal" to g.id)) })
                        }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Sp.s4)) {
                if (row.status == "done") OutlinedButton(onClick = { actions.reopen(row) }) { Text("Not done") }
                else if (row.status == "open") Button(onClick = { commit(); actions.done(row); onDismiss() }) { Text("Done") }
                OutlinedButton(onClick = { actions.move(row, if (row.profile == WORK) PERSONAL else WORK) }) { Text("Move to ${profileLabel(if (row.profile == WORK) PERSONAL else WORK)}") }
                TextButton(onClick = { actions.delete(row); onDismiss() }) { Text("Delete", color = av.err) }
            }
            Spacer(Modifier.padding(bottom = Sp.s8))
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
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.imePadding().navigationBarsPadding().padding(horizontal = Sp.s8, vertical = Sp.s4), verticalArrangement = Arrangement.spacedBy(Sp.s6)) {
            OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth().focusRequester(focus), placeholder = { Text("What would you like to do?") }, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { add() }))
            OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), placeholder = { Text("Description") }, minLines = 2)
            val hint = listOfNotNull(parsed.at?.let { "Due ${whenText(it, now)}" }, parsed.repeat?.substringAfter("Repeats: "), parsed.tags.takeIf { it.isNotEmpty() }?.joinToString(" ") { "#$it" }).joinToString(" · ")
            if (hint.isNotEmpty()) Text(hint, style = MaterialTheme.typography.labelMedium, color = av.accentText)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Sp.s4), verticalArrangement = Arrangement.spacedBy(Sp.s2)) {
                AssistChip(onClick = { pickDue = true }, label = { Text(if (picked) dueLabel(due, now) else "Date") }, leadingIcon = { Icon(Icons.Filled.DateRange, null) })
                AssistChip(onClick = { priority = (priority + 3) % 4 }, label = { Text("Priority: ${priorityLabel(priority)}") })
                if (profile == null) AssistChip(onClick = { target = if (target == WORK) PERSONAL else WORK }, label = { Text(profileLabel(target)) })
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button(onClick = { add() }, enabled = parsed.title.isNotEmpty()) { Icon(Icons.AutoMirrored.Filled.Send, null); Text("  Add task") }
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
fun NeedsSheet(needs: List<Need>, now: Long, actions: TaskActions, hub: Hub, onOpen: (Row) -> Unit, onDismiss: () -> Unit) {
    var all by remember { mutableStateOf(setOf<String>()) }
    @OptIn(ExperimentalMaterial3Api::class)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = Sp.s8)) {
            val groups = listOf("Tasks" to needs.filter { it.isTask }, "Asks" to needs.filter { !it.isTask }).filter { it.second.isNotEmpty() }
            if (groups.isEmpty()) Empty("Nothing needs you")
            groups.forEach { (label, rows) ->
                SectionHeader(label, rows.size.toString())
                val shown = if (label in all) rows else rows.take(NEEDS_CAP)
                Group {
                    shown.forEachIndexed { i, n ->
                        if (i > 0) Hairline()
                        NeedRow(n, now, actions, hub, onOpen)
                    }
                    if (shown.size < rows.size) { Hairline(); PlainRow("Show all ${rows.size}", onClick = { all = all + label }) }
                }
            }
        }
    }
}

@Composable
private fun NeedRow(n: Need, now: Long, actions: TaskActions, hub: Hub, onOpen: (Row) -> Unit) {
    when (n) {
        is Need.Overdue -> PlainRow(n.row.title ?: "", n.row.at?.let { "Overdue · due ${whenText(it, now)}" }, leading = { CheckCircle(false, "Done") { actions.done(n.row) } },
            trailing = { MoreButton { close -> DropdownMenuItem(text = { Text("Snooze to next 09:00") }, onClick = { close(); actions.snoozeLater(n.row) }) } }, onClick = { onOpen(n.row) })
        is Need.OverdueAll -> PlainRow("${n.rows.size} overdue", "Move them all to today", trailing = { TextButton(onClick = { actions.moveToToday(n.rows) }) { Text("Move to today") } })
        is Need.JustEnded -> PlainRow(n.row.title ?: "", "Just ended · ${n.meeting.title}", leading = { CheckCircle(false, "Done") { actions.done(n.row) } }, onClick = { onOpen(n.row) })
        is Need.Ask -> PlainRow(n.row.title ?: "", listOfNotNull(n.row.people, firstLine(n.row.text).ifEmpty { null }).joinToString(" · "), onClick = { onOpen(n.row) },
            trailing = { Row { TextButton(onClick = { actions.dismiss(n.row) }) { Text("Dismiss", color = av.fgMuted) }; TextButton(onClick = { actions.accept(n.row) }) { Text("Add") } } })
        is Need.Dm -> PlainRow(n.chat.str("name") ?: "DM", "DM · ${n.chat.str("summary") ?: ""}",
            trailing = { TextButton(onClick = { hub.codex.capture("Reply to ${n.chat.str("name") ?: "DM"}", "open", n.chat.profile, null, mapOf("text" to listOfNotNull(n.chat.str("summary"), n.chat.str("url")).joinToString("\n\n").ifEmpty { null }, "source" to "slack", "people" to "${n.chat.str("name")} · DM")) }) { Text("Make task") } })
    }
}

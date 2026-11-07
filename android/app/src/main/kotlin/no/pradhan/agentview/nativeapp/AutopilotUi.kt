package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

// The settings of replying on my behalf in Slack (web/src/codex/jobs/Autopilot.tsx and AutopilotPage.tsx).
private class Autopilot(val ops: AutopilotOps) {
    var state by mutableStateOf<AutopilotState?>(null)
    var error by mutableStateOf("")

    suspend fun load() {
        runCatching { ops.load() }.onSuccess { state = it; error = "" }.onFailure { error = it.message ?: "Could not load" }
    }

    fun save(patch: String) = ops.save(patch) { s -> if (s != null) { state = s; error = "" } }
}

@Composable
private fun rememberAutopilot(hub: Hub): Autopilot {
    val origin by hub.origin.collectAsState()
    val model = remember(hub, origin) { Autopilot(AutopilotOps(hub.api, hub.writes)) }
    LaunchedEffect(model) { model.load() }
    return model
}

// The row on the Jobs page: the mode in one line and the switch; a tap opens the page.
@Composable
fun AutopilotRow(hub: Hub, waiting: Int, onOpen: () -> Unit) {
    val ap = rememberAutopilot(hub)
    val s = ap.state
    Group(Modifier.padding(top = Tokens.sp4)) {
        ListRow("Reply for me in Slack", ap.error.ifEmpty { if (s != null) modeLine(s, waiting) else "Loading" }, onClick = onOpen,
            trailing = { if (s != null) Toggle(s.config.enabled) { ap.save(togglePatch("enabled", it)) } })
    }
}

private enum class Which { Info, Away, Covers, Never, Model, Activity }

@Composable
private fun SettingRow(title: String, meta: String?, onClick: () -> Unit) = ListRow(title, meta, onClick = onClick, trailing = { Text("›", style = Type.callout, color = av.fgMuted) })

@Composable
private fun statusColor(kind: String): Color = when (kind) { "sent", "done" -> av.ok; "waiting" -> av.warn; "failed" -> av.err; else -> av.fgMuted }

@Composable
fun AutopilotPage(hub: Hub, st: CodexState, now: Long, onReplies: () -> Unit) {
    val ap = rememberAutopilot(hub)
    var sheet by rememberSaveable { mutableStateOf<String?>(null) }
    val s = ap.state
    val which = sheet?.let { Which.valueOf(it) }
    LazyColumn(Modifier.fillMaxWidth()) {
        if (ap.error.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Could not load or save", ap.error) } }
        item { Group(Modifier.padding(top = Tokens.sp4)) { SettingRow("How it works", null) { sheet = Which.Info.name } } }
        if (s != null) item {
            Group(Modifier.padding(top = Tokens.sp4)) {
                SettingRow("Away", awayValue(s)) { sheet = Which.Away.name }; Hairline()
                SettingRow("Covers", coversValue(s)) { sheet = Which.Covers.name }; Hairline()
                SettingRow("Never answers", neverValue(s)) { sheet = Which.Never.name }; Hairline()
                SettingRow("Model", modelValue(s)) { sheet = Which.Model.name }; Hairline()
                ListRow("Dry run", trailing = { Toggle(s.config.dry_run) { ap.save(togglePatch("dry_run", it)) } }); Hairline()
                SettingRow("Activity", activityValue(s, now)) { sheet = Which.Activity.name }
            }
        }
    }
    if (which == null) return
    val close = { sheet = null }
    if (which == Which.Info) { InfoSheet(s, onReplies, close); return }
    if (s == null) return
    when (which) {
        Which.Away, Which.Never -> FormSheet(which == Which.Away, s, { patch -> ap.save(patch) }, close)
        Which.Covers -> CoversSheet(s, { ap.save(it) }, close)
        Which.Model -> Sheet(close) {
            SectionHeader("Model")
            FlowRow(Modifier.padding(horizontal = Tokens.sp8), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                listOf("sonnet" to "Sonnet", "opus" to "Opus").forEach { (m, label) -> Chip(label, { if (s.config.model != m) ap.save(modelPatch(m)) }, on = s.config.model == m) }
            }
        }
        else -> ActivitySheet(s, st.items, now, close)
    }
}

@Composable
private fun InfoSheet(s: AutopilotState?, onReplies: () -> Unit, close: () -> Unit) {
    val a = s?.config?.away
    Sheet(close) {
        SectionHeader("How it works")
        val text = if (a != null && a.from.isNotEmpty() && a.to.isNotEmpty())
            "From ${autopilotDay(a.from)} to ${autopilotDay(a.to)} it answers simple questions itself when the thread or your wiki has the answer, and sends one holding note${if (a.backup.isNotEmpty()) ", naming ${a.backup}" else ""}.\nUrgent asks and people on the never-answer list always come to you."
        else "Each ask gets a draft. Send, Edit or Skip it from the Reply queue or the push.\nNothing goes out on its own."
        Text(text, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fgMuted)
        Button("Open the Reply queue", { close(); onReplies() }, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp4), variant = ButtonVariant.Tinted)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DayDialog(initial: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val day = runCatching { LocalDate.parse(initial) }.getOrNull() ?: Instant.now().atZone(codexZone).toLocalDate()
    val picker = rememberDatePickerState(initialSelectedDateMillis = day.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = { Button("Set", { picker.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }; onDismiss() }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) },
        dismissButton = { Button("Clear", { onPick(""); onDismiss() }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) },
    ) { DatePicker(picker) }
}

// Away or Never answers: the fields are one form, saved as a single patch when the sheet closes.
@Composable
private fun FormSheet(away: Boolean, s: AutopilotState, save: (String) -> Unit, close: () -> Unit) {
    var form by remember { mutableStateOf(formOf(s)) }
    var picking by remember { mutableStateOf<String?>(null) }
    val done = { formPatch(form, s)?.let(save); close() }
    Sheet(done) {
        SectionHeader(if (away) "Away" else "Never answers")
        Column(Modifier.padding(horizontal = Tokens.sp8), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            if (away) {
                FieldLabel("Away from")
                Button(form.from.ifEmpty { "Not set" }.let { if (form.from.isEmpty()) it else autopilotDay(form.from) }, { picking = "from" })
                FieldLabel("Away to")
                Button(if (form.to.isEmpty()) "Not set" else autopilotDay(form.to), { picking = "to" })
                FieldLabel("Backup")
                TextField(form.backup, { form = AutopilotForm(form.from, form.to, it, form.note, form.escalate, form.manager) }, singleLine = true, placeholder = "Who covers while you are away")
                FieldLabel("Away note")
                TextField(form.note, { form = AutopilotForm(form.from, form.to, form.backup, it, form.escalate, form.manager) }, singleLine = true, placeholder = "Extra line for the holding note")
            } else {
                FieldLabel("Manager")
                TextField(form.manager, { form = AutopilotForm(form.from, form.to, form.backup, form.note, form.escalate, it) }, singleLine = true, placeholder = "Your manager, name or Slack user id")
                FieldLabel("Never answer")
                TextField(form.escalate, { form = AutopilotForm(form.from, form.to, form.backup, form.note, it, form.manager) }, singleLine = true, placeholder = "Names or Slack user ids, comma separated")
            }
        }
    }
    picking?.let { which ->
        DayDialog(if (which == "from") form.from else form.to, { d -> form = if (which == "from") AutopilotForm(d, form.to, form.backup, form.note, form.escalate, form.manager) else AutopilotForm(form.from, d, form.backup, form.note, form.escalate, form.manager) }) { picking = null }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CoversSheet(s: AutopilotState, save: (String) -> Unit, close: () -> Unit) {
    Sheet(close) {
        SectionHeader("Covers")
        FlowRow(Modifier.padding(horizontal = Tokens.sp8), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Chip("DMs", { save(togglePatch("dms", !s.config.dms)) }, on = s.config.dms)
            s.watched.forEach { n -> Chip("#$n", { save(channelsPatch(s, n)) }, on = n in s.covered) }
        }
    }
}

@Composable
private fun ActivitySheet(s: AutopilotState, items: List<Row>, now: Long, close: () -> Unit) {
    var all by remember { mutableStateOf(false) }
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    val spend = spendLine(s)
    Sheet(close, padded = false) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (s.replies.isNotEmpty()) {
                SectionHeader("Seen", s.replies.size.toString())
                Group {
                    (if (all) s.replies else s.replies.take(5)).forEachIndexed { i, r ->
                        if (i > 0) Hairline()
                        val (label, kind) = replyBadge(r, items)
                        val link = safeHref(r.url)
                        ListRow("${r.who ?: ""}${if (r.chat != null) " · ${r.chat}" else ""}", if (r.text != null) "${autopilotWhen(r.at, now)} · ${r.text}" else autopilotWhen(r.at, now),
                            onClick = link?.let { l -> { uri.openUri(l) } },
                            trailing = { RowLabel(label, statusColor(kind)) })
                    }
                    if (!all && s.replies.size > 5) { Hairline(); ListRow("Show all ${s.replies.size}", onClick = { all = true }) }
                }
            }
            if (spend.isNotEmpty()) { SectionHeader("Spend"); Text(spend, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.subheadline, color = av.fgMuted) }
        }
    }
}

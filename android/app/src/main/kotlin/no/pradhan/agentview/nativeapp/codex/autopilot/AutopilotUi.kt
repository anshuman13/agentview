package no.pradhan.agentview.nativeapp.codex.autopilot

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import java.time.Instant
import java.time.LocalDate
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.FieldLabel
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Toggle
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.DateDialog

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

// The row on the Jobs page: the mode in one line; a tap opens the page.
@Composable
fun AutopilotRow(hub: Hub, waiting: Int, onOpen: () -> Unit) {
    val ap = rememberAutopilot(hub)
    val s = ap.state
    Group(Modifier.padding(top = Tokens.sp4)) {
        ListRow("Reply for me in Slack", ap.error.ifEmpty { if (s != null) modeLine(s, waiting) else "Loading…" }, onClick = onOpen, trailing = { Chevron() })
    }
}

private enum class Which { Info, Away, Covers, Never, Model, Activity }

@Composable
private fun SettingRow(title: String, meta: String?, onClick: () -> Unit) = ListRow(title, meta, onClick = onClick, trailing = { Chevron() })

@Composable
fun AutopilotPage(hub: Hub, st: CodexState, now: Long, onReplies: () -> Unit, onTask: (Row) -> Unit) {
    val ap = rememberAutopilot(hub)
    var sheet by rememberSaveable { mutableStateOf<String?>(null) }
    val s = ap.state
    val which = sheet?.let { Which.valueOf(it) }
    LazyColumn(Modifier.fillMaxWidth()) {
        if (ap.error.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Could not load or save", ap.error) } }
        if (s != null) item {
            Group(Modifier.padding(top = Tokens.sp4)) {
                ListRow("Read and draft", trailing = { Toggle(s.config.enabled) { ap.save(togglePatch("enabled", it)) } }); Hairline()
                SettingRow("Covers", coversValue(s)) { sheet = Which.Covers.name }; Hairline()
                SettingRow("Activity", activityValue(s, now)) { sheet = Which.Activity.name }; Hairline()
                SettingRow("How it works", null) { sheet = Which.Info.name }
            }
            // Sending on its own is a beta: its settings show only with Auto send on.
            val auto = s.config.auto_send
            Group(Modifier.padding(top = Tokens.sp4)) {
                ListRow("Auto send (beta)", if (auto) "Sends replies itself while away" else "Off: every draft waits for you", trailing = { Toggle(auto) { ap.save(togglePatch("auto_send", it)) } })
                if (auto) {
                    Hairline(); SettingRow("Away", awayValue(s)) { sheet = Which.Away.name }; Hairline()
                    SettingRow("Never answers", neverValue(s)) { sheet = Which.Never.name }; Hairline()
                    SettingRow("Model", modelValue(s)) { sheet = Which.Model.name }; Hairline()
                    ListRow("Dry run", trailing = { Toggle(s.config.dry_run) { ap.save(togglePatch("dry_run", it)) } })
                }
            }
        }
        else item { Group(Modifier.padding(top = Tokens.sp4)) { SettingRow("How it works", null) { sheet = Which.Info.name } } }
    }
    if (which == null) return
    val close = { sheet = null }
    if (which == Which.Info) { InfoSheet(s, onReplies, close); return }
    if (s == null) return
    when (which) {
        Which.Away, Which.Never -> FormSheet(which == Which.Away, s, { patch -> ap.save(patch) }, close)
        Which.Covers -> CoversSheet(s, { ap.save(it) }, close)
        Which.Model -> Sheet(close, "Model", padded = false) {
            FlowRow(Modifier.padding(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                listOf("sonnet" to "Sonnet", "opus" to "Opus").forEach { (m, label) -> Chip(label, { if (s.config.model != m) ap.save(modelPatch(m)) }, on = s.config.model == m) }
            }
        }
        else -> ActivitySheet(s, st.items, now, onTask, close)
    }
}

@Composable
private fun InfoSheet(s: AutopilotState?, onReplies: () -> Unit, close: () -> Unit) {
    val a = s?.config?.away
    Sheet(close, "How it works", padded = false) {
        val text = if (a != null && s.config.auto_send && a.from.isNotEmpty() && a.to.isNotEmpty())
            "From ${autopilotDay(a.from)} to ${autopilotDay(a.to)} it answers simple questions itself when the thread or your wiki has the answer, and sends one holding note${if (a.backup.isNotEmpty()) ", naming ${a.backup}" else ""}.\nUrgent asks and people on the never-answer list always come to you."
        else "Each ask gets a draft. Send, Edit or Skip it from the Reply queue or the push.\nNothing goes out on its own."
        Text(text, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), style = Type.body, color = av.fgMuted)
        Button("Open the Reply queue", { close(); onReplies() }, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), variant = ButtonVariant.Tinted)
    }
}

@Composable
private fun DayDialog(initial: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val day = runCatching { LocalDate.parse(initial) }.getOrNull() ?: Instant.now().atZone(codexZone).toLocalDate()
    DateDialog(day, "Set", "Clear", { d -> d?.let { onPick(it.toString()) }; onDismiss() }, { onPick(""); onDismiss() }, onDismiss)
}

// Away or Never answers: the fields are one form, saved as a single patch when the sheet closes.
@Composable
private fun FormSheet(away: Boolean, s: AutopilotState, save: (String) -> Unit, close: () -> Unit) {
    var form by remember { mutableStateOf(formOf(s)) }
    var picking by remember { mutableStateOf<String?>(null) }
    val done = { formPatch(form, s)?.let(save); close() }
    Sheet(done, if (away) "Away" else "Never answers", padded = false) {
        Column(Modifier.padding(horizontal = Tokens.listPad), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            if (away) {
                FieldLabel("Away from")
                Button(if (form.from.isEmpty()) "Not set" else autopilotDay(form.from), { picking = "from" })
                FieldLabel("Away to")
                Button(if (form.to.isEmpty()) "Not set" else autopilotDay(form.to), { picking = "to" })
                FieldLabel("Backup")
                TextField(form.backup, { form = form.copy(backup = it) }, singleLine = true, placeholder = "Who covers while you are away")
                FieldLabel("Away note")
                TextField(form.note, { form = form.copy(note = it) }, singleLine = true, placeholder = "Extra line for the holding note")
            } else {
                FieldLabel("Manager")
                TextField(form.manager, { form = form.copy(manager = it) }, singleLine = true, placeholder = "Your manager, name or Slack user id")
                FieldLabel("Never answer")
                TextField(form.escalate, { form = form.copy(escalate = it) }, singleLine = true, placeholder = "Names or Slack user ids, comma separated")
            }
        }
    }
    picking?.let { which ->
        DayDialog(if (which == "from") form.from else form.to, { d -> form = if (which == "from") form.copy(from = d) else form.copy(to = d) }) { picking = null }
    }
}

@Composable
private fun CoversSheet(s: AutopilotState, save: (String) -> Unit, close: () -> Unit) {
    Sheet(close, "Covers", padded = false) {
        Group {
            ListRow("DMs", trailing = { Toggle(s.config.dms) { save(togglePatch("dms", it)) } })
            s.watched.forEach { n ->
                Hairline()
                ListRow("#$n", trailing = { Toggle(n in s.covered) { save(channelsPatch(s, n)) } })
            }
        }
    }
}

@Composable
private fun ActivitySheet(s: AutopilotState, items: List<Row>, now: Long, onTask: (Row) -> Unit, close: () -> Unit) {
    var all by remember { mutableStateOf(false) }
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    val spend = spendLine(s)
    Sheet(close, "Activity", padded = false) {
        if (s.replies.isNotEmpty()) {
            SectionHeader("Seen", s.replies.size.toString())
            Group {
                (if (all) s.replies else s.replies.take(5)).forEachIndexed { i, r ->
                    if (i > 0) Hairline()
                    val (label, kind) = replyBadge(r, items)
                    val link = safeHref(r.url)
                    val task = items.firstOrNull { !it.deleted && ((r.id.isNotEmpty() && it.id == r.id) || (r.url != null && it.sourceUrl == r.url)) }
                    ListRow("${r.who ?: ""}${if (r.chat != null) " · ${r.chat}" else ""}", if (r.text != null) "${autopilotWhen(r.at, now)} · ${r.text}" else autopilotWhen(r.at, now),
                        onClick = if (task != null) ({ close(); onTask(task) }) else link?.let { l -> { uri.openUri(l) } },
                        trailing = { Badge(label, when (kind) { "waiting" -> BadgeTone.Waiting; "sent", "done" -> BadgeTone.Done; "failed" -> BadgeTone.Failed; else -> BadgeTone.Quiet }) })
                }
                if (!all && s.replies.size > 5) { Hairline(); ListRow("Show all ${s.replies.size}", onClick = { all = true }) }
            }
        }
        if (spend.isNotEmpty()) { SectionHeader("Spend"); Text(spend, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.subheadline, color = av.fgMuted) }
    }
}

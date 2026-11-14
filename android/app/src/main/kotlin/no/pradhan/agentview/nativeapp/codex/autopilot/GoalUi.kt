package no.pradhan.agentview.nativeapp.codex.autopilot

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.jobs.money
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.track
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.newChat
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.net.runControl
import no.pradhan.agentview.nativeapp.net.runEdit
import no.pradhan.agentview.nativeapp.net.submit
import no.pradhan.agentview.nativeapp.sessions.advisorLoopGoal
import no.pradhan.agentview.nativeapp.sessions.advisorOf
import no.pradhan.agentview.nativeapp.sessions.askAdvisor
import no.pradhan.agentview.nativeapp.sessions.folderName
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.RowLabel
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.parseFile
import no.pradhan.agentview.nativeapp.workspace.planCondition
import no.pradhan.agentview.nativeapp.workspace.specProgress
import no.pradhan.agentview.nativeapp.workspace.specTasks

private class BeforeLoop(val every: Long, val custom: String, val stopIn: Long?, val stopAt: String?, val capPct: Int?, val builds: Int?, val inHere: Boolean)

// The goal sheets (web/src/sessions/GoalSheets.tsx), mounted once in the app shell.
@Composable
fun GoalSheets(hub: Hub) {
    val sheet by hub.goalSheet.collectAsState()
    val state by hub.store.state.collectAsState()
    val close = { hub.goalSheet.value = null }
    when (val s = sheet) {
        is GoalSheet.Start -> GoalStartSheet(hub, s, close)
        is GoalSheet.Detail -> state.runs.firstOrNull { it.id == s.run }?.let { GoalDetailSheet(hub, it, close) }
        null -> {}
    }
}

internal class PlanRead(val markdown: String? = null, val error: Boolean = false) {
    val progress = markdown?.let { specTasks(it) }?.takeIf { it.isNotEmpty() }?.let { specProgress(it) }
}

// A plan file's text and "N of M done" (null without tasks), read again when a file changes.
@Composable
internal fun planRead(hub: Hub, path: String?, chat: String): PlanRead {
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(hub) { hub.fileChanged.collect { tick++ } }
    val read by produceState(PlanRead(), path, chat, tick) {
        if (path != null) runCatching { parseFile(hub.api.get("/api/file?path=${enc(path)}", chat)).content }
            .onSuccess { value = PlanRead(it) }
            .onFailure { value = PlanRead(value.markdown, true) }
    }
    return read
}

@Composable
internal fun planProgress(hub: Hub, path: String?, chat: String): String? = planRead(hub, path, chat).progress

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Chips(content: @Composable () -> Unit) = FlowRow(
    Modifier.fillMaxWidth().padding(Tokens.sp6),
    horizontalArrangement = Arrangement.spacedBy(Tokens.sp4),
    verticalArrangement = Arrangement.spacedBy(Tokens.sp4),
    itemVerticalAlignment = Alignment.CenterVertically,
    content = { content() },
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StopTimeDialog(onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val time = rememberTimePickerState(initialHour = 7, initialMinute = 0, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = av.raised,
        shape = RoundedCornerShape(Tokens.shapeLg),
        title = { Text("Stop at", style = Type.headline, color = av.fg) },
        text = { TimePicker(time) },
        confirmButton = { Button("Set", { onPick("%02d:%02d".format(time.hour, time.minute)); onDismiss() }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) },
        dismissButton = { Button("Cancel", onDismiss, variant = ButtonVariant.Plain, size = ButtonSize.Sm) },
    )
}

@Composable
private fun <T> MenuChip(label: String, items: List<T>, name: (T) -> String, checked: (T) -> Boolean, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Chip(label, { open = true }, on = true, trailingIcon = "chevron-down")
        Menu(open, { open = false }) { items.forEach { MenuItem(name(it), "circle-small", { open = false; onPick(it) }, checked = checked(it)) } }
    }
}

// The start sheet (web GoalSheet): what, how often, stop at, usage cap and where, then Start.
@Composable
private fun GoalStartSheet(hub: Hub, sheet: GoalSheet.Start, onClose: () -> Unit) {
    val state by hub.store.state.collectAsState()
    val ws by hub.workspace.collectAsState()
    val allProviders by hub.providers.collectAsState()
    val defaultProvider by hub.defaultProvider.collectAsState()
    val providers = allProviders.filter { it.enabled }
    val cwd = state.session?.cwd.orEmpty()
    val active = state.runs.any { it.chatId == state.shownId && it.state != "done" }
    val canHere = sheet.here && !active
    var what by remember { mutableStateOf("") }
    var advisor by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var every by remember { mutableStateOf(EVERY.first().ms) }
    var custom by remember { mutableStateOf("") }
    var stopIn by remember { mutableStateOf<Long?>(null) }
    var stopAt by remember { mutableStateOf<String?>(null) }
    var capPct by remember { mutableStateOf<Int?>(70) }
    var builds by remember { mutableStateOf<Int?>(null) }
    var inHere by remember { mutableStateOf(false) }
    var dir by remember { mutableStateOf(cwd) }
    var beforeLoop by remember { mutableStateOf<BeforeLoop?>(null) }
    var providerId by remember { mutableStateOf(defaultProvider) }
    var pickTime by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    val presets by hub.goalPresets.collectAsState()
    var preset by remember { mutableStateOf<String?>(null) }
    var naming by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(sent) { if (sent) { delay(10_000); sent = false } }
    val loop = advisor && sheet.plan == null
    val here = canHere && inHere && !loop
    val target = if (loop) "claude" else if (here) state.session?.provider else providerId
    val dirs = (ws.repos.map { it.cwd to it.name } + ws.trees.map { it.cwd to it.name.substringAfterLast('/') }).let { l -> if (cwd.isNotEmpty() && l.none { it.first == cwd }) listOf(cwd to folderName(cwd)) + l else l }
    val read = planRead(hub, sheet.plan, hub.pageChat)
    val badEvery = custom.isNotBlank() && parseEvery(custom) == null
    val ready = !badEvery && (sheet.plan == null || (read.markdown != null && !read.error))
    val usable = { d: String -> !(loop && advisorOf(d) != null) }
    val root = if (dir.isNotEmpty() && usable(dir)) dir else dirs.firstOrNull { usable(it.first) }?.first.orEmpty()
    val condition = sheet.plan?.let { p -> read.markdown?.let { planCondition(p, it) } } ?: if (loop) (if (root.isEmpty()) "" else advisorLoopGoal(root)) else what
    val start = {
        hub.track("action:startGoal")
        val text = goalCommand(GoalForm(condition, every, stopIn, stopAt, if (billing(target) == "none") null else capPct, builds), System.currentTimeMillis())
        if (loop) {
            scope.askAdvisor(hub, "pm", text, onClose)
        } else if (here) {
            hub.submit(text, false) { hub.notice.value = "Could not send the goal. Try again." }
            onClose()
        } else {
            sent = true
            hub.newChat(cwd = root.ifEmpty { null }, provider = providerId, text = text, onOpened = onClose)
        }
    }
    val applyPreset = { p: GoalPreset ->
        if (advisor) { advisor = false; beforeLoop?.let { inHere = it.inHere } }
        if (sheet.plan == null) what = p.what
        every = p.every; custom = if (EVERY.any { it.ms == p.every }) "" else everyText(p.every)
        stopIn = p.stopIn; stopAt = p.stopAt; capPct = p.capPct; builds = p.builds
        preset = p.name
    }
    val savePreset = {
        val next = addPreset(presets, GoalPreset(naming.orEmpty(), if (sheet.plan == null) what else "", every, stopIn, stopAt, capPct, builds))
        hub.saveGoalPresets(next)
        preset = next.first().name
        naming = null
    }
    val presetStop = STOPS.any { it.stopIn == stopIn && it.stopAt == stopAt }
    Sheet(onClose, "New goal", padded = false) {
        SectionHeader("What")
        Group {
            if (sheet.plan == null || presets.isNotEmpty()) Chips {
                if (sheet.plan == null) Chip("Advisor loop", {
                    advisor = !advisor
                    if (advisor) {
                        beforeLoop = BeforeLoop(every, custom, stopIn, stopAt, capPct, builds, inHere)
                        custom = ""; every = ADVISOR_LOOP_EVERY; stopIn = null; stopAt = null; capPct = ADVISOR_LOOP_CAP; builds = ADVISOR_LOOP_BUILDS; inHere = false
                    } else beforeLoop?.let { what = ""; custom = it.custom; every = it.every; stopIn = it.stopIn; stopAt = it.stopAt; capPct = it.capPct; builds = it.builds; inHere = it.inHere }
                }, on = advisor)
                presets.forEach { p -> Chip(p.name, { applyPreset(p) }, on = preset == p.name) }
                preset?.let { name -> Button("Delete preset", { hub.saveGoalPresets(removePreset(presets, name)); preset = null }, variant = ButtonVariant.Danger) }
            }
            if (sheet.plan != null) ListRow(sheet.plan, if (read.error) "Could not read the plan. Check the file still exists." else read.markdown?.let { read.progress ?: "No tasks" }, lines = 1)
            else Box(Modifier.padding(Tokens.sp6)) { TextField(if (loop) condition else what, { what = it }, enabled = !loop, placeholder = "What is the goal?", minLines = 3) }
        }
        SectionHeader("How often")
        Group {
            Chips { EVERY.forEach { Chip(it.label, { custom = ""; every = it.ms }, on = custom.isBlank() && it.ms == every) } }
            Box(Modifier.padding(start = Tokens.sp6, end = Tokens.sp6, bottom = Tokens.sp6)) {
                TextField(custom, { custom = it; every = parseEvery(it) ?: 0 }, placeholder = "Custom, like 10m or 3h", singleLine = true)
            }
            if (badEvery) Text("Use minutes or hours from 10m to 168h, like 45m or 3h", Modifier.padding(start = Tokens.sp6, end = Tokens.sp6, bottom = Tokens.sp6), style = Type.footnote, color = av.fgMuted)
        }
        SectionHeader("Stop at")
        Group {
            Chips {
                STOPS.forEach { s -> Chip(s.label, { stopIn = s.stopIn; stopAt = s.stopAt }, on = s.stopIn == stopIn && s.stopAt == stopAt) }
                Chip(if (presetStop) "Pick time" else stopAt ?: "Pick time", { pickTime = true }, on = !presetStop)
            }
        }
        if (billing(target) != "none") {
            SectionHeader("Usage cap")
            Group {
                Chips { CAPS.forEach { Chip(it.label, { capPct = it.pct }, on = it.pct == capPct) } }
                Text("Skips rounds while the 5-hour window is over 90%", Modifier.padding(start = Tokens.sp6, end = Tokens.sp6, bottom = Tokens.sp6), style = Type.footnote, color = av.fgMuted)
            }
        }
        SectionHeader("Build limit")
        Group {
            Chips { BUILDS.forEach { Chip(it.label, { builds = it.n }, on = it.n == builds) } }
        }
        SectionHeader("Where")
        Group {
            Chips {
                if (canHere && !loop) {
                    Chip("New chat", { inHere = false }, on = !inHere)
                    Chip("This chat", { inHere = true }, on = inHere)
                }
                if (!here) {
                    if (sheet.plan == null) MenuChip(folderName(root), dirs, { it.second }, { it.first == root }) { dir = it.first }
                    if (!loop) MenuChip(providerLabel(providerId), providers, { it.label }, { it.id == providerId }) { providerId = it.id }
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad)) {
            Button("Start", start, Modifier.fillMaxWidth(), variant = ButtonVariant.Filled, size = ButtonSize.Lg, enabled = !hub.readOnly && !sent && ready && condition.isNotBlank())
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
            val draft = naming
            if (draft == null) Button("Save as preset", { naming = (sheet.plan?.substringAfterLast('/') ?: what.trim()).take(MAX_NAME) }, variant = ButtonVariant.Tinted, enabled = !loop)
            else {
                Box(Modifier.weight(1f)) { TextField(draft, { naming = it.take(MAX_NAME) }, placeholder = "Preset name", singleLine = true) }
                Button("Save", savePreset, variant = ButtonVariant.Tinted, enabled = !loop && !badEvery && draft.isNotBlank())
            }
        }
    }
    if (pickTime) StopTimeDialog({ stopIn = null; stopAt = it }, { pickTime = false })
}

// One row of the detail; with options a tap opens a menu of them.
@Composable
private fun EditRow(title: String, value: String, options: List<Pair<String, Map<String, Long?>>>?, onEdit: (Map<String, Long?>) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        ListRow(title, trailing = { RowLabel(value) }, onClick = options?.let { { open = true } })
        if (options != null) Menu(open, { open = false }) { options.forEach { (label, edit) -> MenuItem(label, "circle-small", { open = false; onEdit(edit) }) } }
    }
}

// The goal detail (web GoalDetail): the settings, the rounds and the controls.
@Composable
private fun GoalDetailSheet(hub: Hub, run: ChatRun, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val plan = planOf(run.what)
    val progress = planProgress(hub, plan, run.chatId)
    val ended = run.state == "done"
    val paused = run.state == "paused"
    val editable = !ended && !hub.readOnly
    val now = System.currentTimeMillis()
    val next = if (paused) "Paused · ${run.why}" else run.nextAt?.let { clock(it) } ?: "When the agent goes idle"
    val (badge, tone) = goalBadge(run)
    val open = { report: String? -> scope.launch { if (hub.openRun(run, report)) { hub.link.value = DeepLink(view = "agents"); onClose() } }; Unit }
    val rows = buildList<@Composable () -> Unit> {
        add { ListRow(run.what, "Condition", lines = 2) }
        if (plan != null) add { ListRow("Plan", trailing = { RowLabel(progress.orEmpty()) }) }
        add { EditRow("How often", run.every?.let { "Every ${everyText(it)}" } ?: "Until done", if (run.every != null && editable) EVERY.filter { it.ms > 0 }.map { it.label to mapOf("every" to it.ms) } else null) { hub.runEdit(run, it) } }
        add { EditRow("Stop at", run.endAt?.let { clock(it) } ?: "None", if (editable) STOPS.map { it.label to mapOf("endAt" to stopAtMs(it, now)) } else null) { hub.runEdit(run, it) } }
        if (billing(run.provider) != "none" || run.maxBuilds != null) add { EditRow("Usage", usageLine(run), if (editable && billing(run.provider) != "none") CAPS.map { (it.pct?.let { p -> "$p% cap" } ?: "No cap") to mapOf("capPct" to it.pct?.toLong()) } else null) { hub.runEdit(run, it) } }
        add { EditRow("Build limit", run.maxBuilds?.toString() ?: "None", if (editable) BUILDS.map { it.label to mapOf("maxBuilds" to it.n?.toLong()) } else null) { hub.runEdit(run, it) } }
        if (!ended) add { ListRow("Next round", trailing = { RowLabel(next) }) }
        add { ListRow("Cost", trailing = { RowLabel(money(run.costUsd, billing(run.provider))) }) }
    }
    Sheet(onClose, run.title.ifBlank { "Goal" }, padded = false) {
        SectionHeader("Goal", action = { Badge(badge, tone) })
        Group { rows.forEachIndexed { i, row -> if (i > 0) Hairline(); row() } }
        SectionHeader("Rounds", run.rounds.size.toString())
        if (run.rounds.isEmpty()) EmptyState("No rounds yet", "The first round runs when the agent goes idle", icon = "history")
        else Group {
            run.rounds.asReversed().forEachIndexed { i, r ->
                if (i > 0) Hairline(lead = true)
                ListRow(
                    roundText(r), money(r.costUsd, billing(run.provider)),
                    leading = { StatusDot(outcomeDot(r.outcome)) }, onClick = r.report?.let { report -> { open(report) } },
                )
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            if (!ended) {
                Button(if (paused) "Resume" else "Pause", { hub.runControl(run, if (paused) "resume" else "pause") }, enabled = !hub.readOnly)
                Button("Stop", { hub.runControl(run, "stop") }, variant = ButtonVariant.Danger, enabled = !hub.readOnly)
            }
            Button("Open chat", { open(run.rounds.lastOrNull()?.report) }, variant = ButtonVariant.Plain)
        }
    }
}

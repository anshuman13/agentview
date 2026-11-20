package no.pradhan.agentview.nativeapp.codex.autopilot

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.chat.modelGroup
import no.pradhan.agentview.nativeapp.chat.startModel
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.jobs.money
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.app.lastModel
import no.pradhan.agentview.nativeapp.app.modelsOf
import no.pradhan.agentview.nativeapp.app.newChat
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.app.readFile
import no.pradhan.agentview.nativeapp.app.runCommits
import no.pradhan.agentview.nativeapp.app.runControl
import no.pradhan.agentview.nativeapp.app.runEdit
import no.pradhan.agentview.nativeapp.app.submit
import no.pradhan.agentview.nativeapp.app.track
import no.pradhan.agentview.nativeapp.sessions.folderName
import no.pradhan.agentview.nativeapp.sessions.since
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
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
import no.pradhan.agentview.nativeapp.ui.rememberLoad
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.workspace.planCondition
import no.pradhan.agentview.nativeapp.workspace.specProgress
import no.pradhan.agentview.nativeapp.workspace.specTasks
import no.pradhan.agentview.nativeapp.ui.TimeDialog


// The goal sheets (web/src/sessions/GoalSheets.tsx), mounted once in the app shell.
@Composable
fun GoalSheets(hub: Hub) {
    val sheet by hub.shell.goalSheet.collectAsState()
    val runs by hub.store.state.select { it.runs }
    val close = { hub.shell.goalSheet.value = null }
    when (val s = sheet) {
        is GoalSheet.Start -> GoalStartSheet(hub, s, close)
        is GoalSheet.Detail -> runs.firstOrNull { it.id == s.run }?.let { GoalDetailSheet(hub, it, close) }
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
    LaunchedEffect(hub, path) { hub.fileChanged.collect { if (path != null && path.endsWith(it)) tick++ } }
    val read by produceState(PlanRead(), path, chat, tick) {
        if (path != null) runCatching { hub.readFile(path, chat).content }
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

@Composable
private fun StopTimeDialog(onPick: (String) -> Unit, onDismiss: () -> Unit) =
    TimeDialog("Stop at", 7, 0, "Set", "Cancel", { h, m -> onPick("%02d:%02d".format(h, m)); onDismiss() }, onDismiss, onDismiss)

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
private fun GoalStartSheet(hub: Hub, opened: GoalSheet.Start, onClose: () -> Unit) {
    val init = remember(opened) { opened.from?.let { rerunForm(it) } }
    val sheet = if (opened.plan == null && init?.plan != null) opened.copy(plan = init.plan) else opened
    val cwd by hub.store.state.select { st -> opened.from?.cwd ?: st.live.firstOrNull { it.id == opened.from?.chatId }?.cwd ?: st.session?.cwd.orEmpty() }
    val chatProvider by hub.store.state.select { it.session?.provider }
    val active by hub.store.state.select { st -> activeRun(st.runs, st.shownId) != null }
    val ws by hub.workspace.collectAsState()
    val allProviders by hub.providers.collectAsState()
    val defaultProvider by hub.defaultProvider.collectAsState()
    val providers = allProviders.filter { it.enabled }
    val canHere = sheet.here && !active
    var what by remember { mutableStateOf(init?.form?.what.orEmpty()) }
    var every by remember { mutableStateOf(init?.form?.every ?: EVERY.first().ms) }
    var custom by remember { mutableStateOf(init?.form?.every?.takeIf { e -> EVERY.none { it.ms == e } }?.let { everyText(it) }.orEmpty()) }
    var stopIn by remember { mutableStateOf<Long?>(null) }
    var stopAt by remember { mutableStateOf<String?>(null) }
    var capPct by remember { mutableStateOf(if (init != null) init.form.capPct else 70) }
    var fiveHour by remember { mutableStateOf(init?.form?.fiveHour) }
    var fiveCustom by remember { mutableStateOf(init?.form?.fiveHour?.takeIf { it !in FIVE_HOURS }.orEmpty()) }
    var capUsd by remember { mutableStateOf(init?.form?.capUsd) }
    var builds by remember { mutableStateOf(init?.form?.builds) }
    var inHere by remember { mutableStateOf(init != null && canHere) }
    var dir by remember { mutableStateOf(cwd) }
    var providerId by remember { mutableStateOf(defaultProvider) }
    val group = modelGroup(providerId, allProviders)
    val models by hub.modelsOf(group).collectAsState()
    var model by remember(models, group) { mutableStateOf(startModel(models, hub.lastModel(group))) }
    var pickTime by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    val presets by hub.goalPresets.collectAsState()
    var preset by remember { mutableStateOf<String?>(null) }
    var naming by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(sent) { if (sent) { delay(10_000); sent = false } }
    val here = canHere && inHere
    val target = if (here) chatProvider else providerId
    val dirs = (ws.repos.map { it.cwd to it.name } + ws.trees.map { it.cwd to "${folderName(it.repo)} · ${it.name.substringAfterLast('/')}" }).let { l -> if (cwd.isNotEmpty() && l.none { it.first == cwd }) listOf(cwd to folderName(cwd)) + l else l }
    val read = planRead(hub, sheet.plan, hub.pageChat)
    val badEvery = custom.isNotBlank() && parseEvery(custom) == null
    val badFive = fiveCustom.isNotBlank() && parseFiveHour(fiveCustom) == null
    val fiveNote = fiveHourLine(fiveHour, capPct, target)
    val ready = !badEvery && !badFive && (sheet.plan == null || (read.markdown != null && !read.error))
    val root = dir.ifEmpty { dirs.firstOrNull()?.first.orEmpty() }
    val condition = sheet.plan?.let { p -> read.markdown?.let { planCondition(p, it) } } ?: what
    val start = {
        hub.track("action:startGoal")
        val text = goalCommand(GoalForm(condition, every, stopIn, stopAt, if (billing(target) == "none") null else capPct, builds, if (billing(target) == "plan") null else capUsd, if (billing(target) == "none") null else fiveHour), System.currentTimeMillis())
        if (here) {
            hub.submit(text, false) { hub.notice.value = "Could not send the goal. Try again." }
            onClose()
        } else {
            sent = true
            hub.newChat(cwd = root.ifEmpty { null }, provider = providerId, model = model, text = text, onOpened = onClose)
        }
    }
    val applyPreset = { p: GoalPreset ->
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
                presets.forEach { p -> Chip(p.name, { applyPreset(p) }, on = preset == p.name) }
                preset?.let { name -> Button("Delete preset", { hub.saveGoalPresets(removePreset(presets, name)); preset = null }, variant = ButtonVariant.Danger) }
            }
            if (sheet.plan != null) ListRow(sheet.plan, if (read.error) "Could not read the plan. Check the file still exists." else read.markdown?.let { read.progress ?: "No tasks" })
            else Box(Modifier.padding(Tokens.sp6)) { TextField(what, { what = it }, placeholder = "What is the goal?", minLines = 3) }
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
            }
            SectionHeader("5-hour pause")
            Group {
                Chips { FIVE_HOURS.forEach { v -> Chip(fiveHourLabel(v), { fiveCustom = ""; fiveHour = v }, on = fiveCustom.isBlank() && v == fiveHour) } }
                Box(Modifier.padding(start = Tokens.sp6, end = Tokens.sp6, bottom = Tokens.sp6)) {
                    TextField(fiveCustom, { fiveCustom = it; fiveHour = parseFiveHour(it)?.toString() }, placeholder = "Custom percent, 1 to 100", singleLine = true)
                }
                val note = if (badFive) "Use a percent from 1 to 100" else fiveNote
                if (note.isNotEmpty()) Text(note, Modifier.padding(start = Tokens.sp6, end = Tokens.sp6, bottom = Tokens.sp6), style = Type.footnote, color = av.fgMuted)
            }
        }
        if (billing(target) != "plan") {
            SectionHeader("Cost cap")
            Group {
                Chips { CAPS_USD.forEach { Chip(it.label, { capUsd = it.usd }, on = it.usd == capUsd) } }
                Text("Ends the goal when its own cost reaches the cap", Modifier.padding(start = Tokens.sp6, end = Tokens.sp6, bottom = Tokens.sp6), style = Type.footnote, color = av.fgMuted)
            }
        }
        SectionHeader("Build limit")
        Group {
            Chips { BUILDS.forEach { Chip(it.label, { builds = it.n }, on = it.n == builds) } }
        }
        SectionHeader("Where")
        Group {
            Chips {
                if (canHere) {
                    Chip("New chat", { inHere = false }, on = !inHere)
                    Chip("This chat", { inHere = true }, on = inHere)
                }
                if (!here) {
                    if (sheet.plan == null) MenuChip(dirs.firstOrNull { it.first == root }?.second ?: folderName(root), dirs, { it.second }, { it.first == root }) { dir = it.first }
                    MenuChip(providerLabel(providerId), providers, { it.label }, { it.id == providerId }) { providerId = it.id }
                    if (models.isNotEmpty()) MenuChip(models.firstOrNull { it.value == model }?.displayName ?: "Default model", models, { it.displayName }, { it.value == model }) { model = it.value }
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad)) {
            Button("Start", start, Modifier.fillMaxWidth(), variant = ButtonVariant.Filled, size = ButtonSize.Lg, enabled = !hub.readOnly && !sent && ready && condition.isNotBlank())
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
            val draft = naming
            if (draft == null) Button("Save as preset", { naming = (sheet.plan?.substringAfterLast('/') ?: what.trim()).take(MAX_NAME) }, variant = ButtonVariant.Tinted)
            else {
                Box(Modifier.weight(1f)) { TextField(draft, { naming = it.take(MAX_NAME) }, placeholder = "Preset name", singleLine = true) }
                Button("Save", savePreset, variant = ButtonVariant.Tinted, enabled = !badEvery && draft.isNotBlank())
            }
        }
    }
    if (pickTime) StopTimeDialog({ stopIn = null; stopAt = it }, { pickTime = false })
}

// One row of the detail; with options a tap opens a menu of them.
@Composable
private fun EditRow(title: String, value: String, options: List<Pair<String, Map<String, Any?>>>?, onEdit: (Map<String, Any?>) -> Unit) {
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
    val detail = runDetail(run)
    val editable = detail.editable && !hub.readOnly
    val now = System.currentTimeMillis()
    val next = if (paused) "Paused · ${run.why}" else run.nextAt?.let { clock(it) } ?: "When the agent goes idle"
    val (badge, tone) = goalBadge(run)
    val clip = LocalClipboardManager.current
    val title = run.title.ifBlank { detail.heading }
    val open = { report: String? -> scope.launch { if (hub.openRun(run, report)) { hub.link.value = DeepLink(view = "agents"); onClose() } }; Unit }
    val facts = buildList<@Composable () -> Unit> {
        add { ListRow(run.what, detail.what, lines = 2) }
        if (plan != null) add { ListRow("Plan", trailing = { RowLabel(progress.orEmpty()) }) }
        if (!ended) add { ListRow("Next round", trailing = { RowLabel(next) }) }
        else finishedLine(run.why, run.endedAt, ::since)?.let { line -> add { ListRow("Ended", trailing = { RowLabel(line) }) } }
        add { ListRow("Cost", trailing = { RowLabel(money(run.costUsd, billing(run.provider))) }) }
    }
    val settings = buildList<@Composable () -> Unit> {
        add { EditRow("How often", run.every?.let { "Every ${everyText(it)}" } ?: "Until done", if (run.every != null && editable) EVERY.filter { it.ms > 0 }.map { it.label to mapOf("every" to it.ms) } else null) { hub.runEdit(run, it) } }
        add { EditRow("Stop at", run.endAt?.let { clock(it) } ?: "None", if (editable) STOPS.map { it.label to mapOf("endAt" to stopAtMs(it, now)) } else null) { hub.runEdit(run, it) } }
        if (billing(run.provider) != "none" || run.maxBuilds != null || run.capUsd != null) add { EditRow("Usage", usageLine(run), if (editable && billing(run.provider) != "none") CAPS.map { (it.pct?.let { p -> "$p% cap" } ?: "No cap") to mapOf("capPct" to it.pct?.toLong()) } else null) { hub.runEdit(run, it) } }
        if (billing(run.provider) != "none") add { EditRow("5-hour pause", fiveHourLabel(fiveHourLimit(run.fiveHour?.content, run.capPct)), if (editable) FIVE_HOURS.map { v -> fiveHourLabel(v) to mapOf("fiveHour" to (v?.toLongOrNull() ?: v)) } else null) { hub.runEdit(run, it) } }
        add { EditRow("Build limit", run.maxBuilds?.toString() ?: "None", if (editable) BUILDS.map { it.label to mapOf("maxBuilds" to it.n?.toLong()) } else null) { hub.runEdit(run, it) } }
    }
    Sheet(onClose, title, padded = false) {
        SectionHeader(detail.heading, action = { Badge(badge, tone) })
        Group { facts.forEachIndexed { i, row -> if (i > 0) Hairline(); row() } }
        SectionHeader("Settings")
        Group { settings.forEachIndexed { i, row -> if (i > 0) Hairline(); row() } }
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            if (!ended) {
                Button(if (paused) "Resume" else "Pause", { hub.runControl(run, if (paused) "resume" else "pause") }, enabled = !hub.readOnly)
                Button("Stop", { hub.runControl(run, "stop") }, variant = ButtonVariant.Danger, enabled = !hub.readOnly)
            }
            if (ended && run.kind == "goal") Button("Run again…", { hub.shell.goalSheet.value = GoalSheet.Start(here = hub.store.state.value.shownId == run.chatId, from = run) }, enabled = !hub.readOnly)
            Button("Open chat", { open(run.rounds.lastOrNull()?.report) }, variant = ButtonVariant.Plain)
        }
        val (changes) = rememberLoad(run.id, run.chatId, run.rounds.size) { hub.runCommits(run) }
        SectionHeader("Changes", changes.data?.size?.toString())
        Group {
            val commits = changes.data
            if (commits == null) ListRow(if (changes.busy) "Reading commits" else "Could not read commits")
            else if (commits.isEmpty()) ListRow("No commits")
            else commits.forEachIndexed { i, c ->
                if (i > 0) Hairline()
                ListRow(c.subject, "${c.hash} · ${since(c.at)}", lines = 1)
            }
        }
        SectionHeader("Rounds", run.rounds.size.toString(), action = if (run.rounds.isEmpty()) null else ({
            IconBtn("copy", "Copy rounds", { clip.setText(AnnotatedString(roundsMarkdown(title, run.rounds, run.provider))); hub.notice.value = "Rounds copied" })
        }))
        if (run.rounds.isEmpty()) EmptyState("No rounds yet", "The first round runs when the agent goes idle", icon = "history")
        else Group {
            mergeQuiet(run.rounds).asReversed().forEachIndexed { i, g ->
                if (i > 0) Hairline(lead = true)
                RoundRow(g, run.provider, open = open)
            }
        }
    }
}

// One round, or a run of quiet rounds, of a loop or goal (web RoundRow); a round with a report opens it.
@Composable
fun RoundRow(g: RoundGroup, provider: String?, compact: Boolean = false, open: (String) -> Unit) {
    ListRow(
        roundGroupText(g), money(g.costUsd, billing(provider)), compact = compact,
        leading = { StatusDot(outcomeDot(g.last.outcome)) }, onClick = g.last.report?.let { report -> { open(report) } },
    )
}

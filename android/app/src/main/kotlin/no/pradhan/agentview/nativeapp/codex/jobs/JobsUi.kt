package no.pradhan.agentview.nativeapp.codex.jobs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row as LayoutRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.codex.meetings.markSegments
import no.pradhan.agentview.nativeapp.codex.meetings.matchLabel
import no.pradhan.agentview.nativeapp.codex.meetings.stepMatch
import no.pradhan.agentview.nativeapp.sessions.queryWords
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.chat.toolId
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.WORK
import no.pradhan.agentview.nativeapp.codex.TaskActions
import no.pradhan.agentview.nativeapp.codex.autopilot.AutopilotRow
import no.pradhan.agentview.nativeapp.codex.profileLabel
import no.pradhan.agentview.nativeapp.codex.replyQueue
import no.pradhan.agentview.nativeapp.codex.split
import no.pradhan.agentview.nativeapp.codex.wiki.agoText
import no.pradhan.agentview.nativeapp.ui.UNTITLED
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.app.mcpProbe
import no.pradhan.agentview.nativeapp.app.askCodex
import no.pradhan.agentview.nativeapp.app.refreshWorkspace
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.ChoiceRow
import no.pradhan.agentview.nativeapp.ops.McpServer
import no.pradhan.agentview.nativeapp.ops.mcpScope
import no.pradhan.agentview.nativeapp.ops.mcpHideKey
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.TimeDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.FieldLabel
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Toggle
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

@Composable
private fun StateBadge(state: JobState) = when (state) {
    JobState.Running -> Badge("Running", BadgeTone.Running)
    JobState.Queued -> Badge("Waiting", BadgeTone.Waiting)
    JobState.Failed -> Badge("Failed", BadgeTone.Failed)
    JobState.Off -> Badge("Skipped", BadgeTone.Quiet)
}

fun toggleJob(hub: Hub, j: Row, on: Boolean) = hub.codex.update(j, mapOf("enabled" to if (on) 1 else 0, "next_run_at" to null))

fun runJobNow(hub: Hub, actions: TaskActions, j: Row) {
    if (hub.codex.update(j, mapOf("next_run_at" to System.currentTimeMillis()))) actions.say("Starts within a minute")
}

private fun deleteJob(actions: TaskActions, j: Row) = actions.change(j, mapOf("deleted" to true), "Deleted ${j.str("name")?.ifEmpty { null } ?: "job"}")

@Composable
private fun JobEditSheet(actions: TaskActions, j: Row, onDismiss: () -> Unit) {
    var name by remember(j.key) { mutableStateOf(j.str("name") ?: "") }
    var prompt by remember(j.key) { mutableStateOf(j.str("prompt") ?: "") }
    Sheet(onDismiss, "Edit job") {
        Column(Modifier.imePadding().padding(vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
            FieldLabel("Name")
            TextField(name, { name = it }, placeholder = "Job name", singleLine = true)
            FieldLabel("Prompt")
            TextField(prompt, { prompt = it }, placeholder = "What should it do?", minLines = 4)
            LayoutRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4, Alignment.End)) {
                Button("Cancel", onDismiss, variant = ButtonVariant.Plain)
                Button("Save", {
                    val patch = jobEdits(j, name, prompt)
                    if (patch.isNotEmpty()) actions.change(j, patch, "Job updated")
                    onDismiss()
                }, variant = ButtonVariant.Filled)
            }
        }
    }
}

private val KINDS = listOf("hourly" to "Every hour", "daily" to "Every day", "weekdays" to "Weekdays", "weekly" to "Once a week")

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun JobScheduleSheet(actions: TaskActions, j: Row, onDismiss: () -> Unit) {
    val s = parseSchedule(j.str("schedule"))
    var pickTime by remember { mutableStateOf(false) }
    val write = { kind: String, day: String, time: String -> actions.change(j, mapOf("schedule" to scheduleOf(kind, day, time), "next_run_at" to null), "Schedule changed") }
    Sheet(onDismiss, "When") {
        Column(Modifier.padding(vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
            FieldLabel("How often")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                KINDS.forEach { (k, label) -> Chip(label, { if (k != s.kind) write(k, s.day, s.time) }, on = k == s.kind) }
                if (s.kind == "custom") Chip("Custom", null, on = true)
            }
            if (s.kind == "weekly") {
                FieldLabel("Day")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    listOf(1, 2, 3, 4, 5, 6, 0).forEach { i -> Chip(DAY_NAMES[i].take(3), { if (DAYS[i] != s.day) write("weekly", DAYS[i], s.time) }, on = DAYS[i] == s.day) }
                }
            }
            if (s.kind != "hourly" && s.kind != "custom") {
                FieldLabel("Time")
                FlowRow { Chip(s.time, { pickTime = true }, icon = "clock") }
            }
        }
    }
    if (pickTime) TimeDialog("Time", s.time.take(2).toInt(), s.time.takeLast(2).toInt(), "Set", "Cancel", { h, m -> pickTime = false; write(s.kind, s.day, "%02d:%02d".format(h, m)) }, { pickTime = false }, { pickTime = false })
}

// JobTools of web/src/codex/jobs/JobParts.tsx: Chrome, each MCP server, then any other saved entry; a tap adds or removes it.
@Composable
private fun JobToolsSheet(hub: Hub, j: Row, probe: List<McpServer>?, failed: Boolean, onDismiss: () -> Unit) {
    val groups by hub.mcpGroups.collectAsState()
    val tools = j.str("tools") ?: ""
    val picked = toolIds(tools)
    val toggle = { id: String -> hub.codex.update(j, mapOf("tools" to toggleConnector(tools, id).ifEmpty { null })) }
    val shown = probe.orEmpty().filter { groups[mcpHideKey(it.name)] != "hidden" }
    val known = listOf("browser") + shown.map { mcpToolId(it.name) }
    Sheet(onDismiss, "Allowed tools") {
        Group {
            ChoiceRow("Chrome", checked = "browser" in picked, onClick = { toggle("browser") })
            if (probe == null && !failed) { Hairline(); ListRow("Loading servers…", muted = true) }
            shown.forEach { s -> Hairline(); ChoiceRow(s.name, mcpScope(s.scope).first, checked = mcpToolId(s.name) in picked, onClick = { toggle(mcpToolId(s.name)) }) }
            picked.filter { it !in known }.forEach { id -> Hairline(); ChoiceRow(id, checked = true, onClick = { toggle(id) }) }
        }
        if (failed) Footnote("Could not load the MCP servers")
        Footnote("Connectors it may use beyond reading, with no one watching. Chrome is AgentView's own browser; a server lets it use every tool that server has.")
    }
}

// JobRepo of web/src/codex/jobs/JobParts.tsx: the main checkouts by name, then None; a tap sets the job's repo.
@Composable
private fun JobRepoSheet(hub: Hub, j: Row, onDismiss: () -> Unit) {
    val ws by hub.workspace.collectAsState()
    val repos = remember(ws.repos) { ws.repos.filter { it.branch.isNotEmpty() }.sortedBy { it.name.lowercase() } }
    val set = { repo: String? -> hub.codex.update(j, mapOf("repo" to repo)); onDismiss() }
    LaunchedEffect(Unit) { hub.refreshWorkspace() }
    Sheet(onDismiss, "Repo") {
        if (repos.isEmpty()) EmptyState("No repos found", "Repos come from the Mac's work folders", icon = "repo")
        Group {
            repos.forEach { r -> ChoiceRow(r.name, checked = r.cwd == j.str("repo"), onClick = { set(r.cwd) }); Hairline() }
            ChoiceRow("None", checked = j.str("repo") == null, onClick = { set(null) })
        }
    }
}

@Composable
private fun Footnote(text: String) = Text(text, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), style = Type.footnote, color = av.fgMuted)

@Composable
private fun JobMenu(hub: Hub, actions: TaskActions, j: Row, canRun: Boolean, close: () -> Unit, onEdit: (() -> Unit)? = null) {
    val on = isEnabled(j)
    if (onEdit != null) MenuItem("Edit", "edit", { close(); onEdit() })
    MenuItem("Run now", "play", { close(); runJobNow(hub, actions, j) }, enabled = canRun && !hub.readOnly)
    MenuItem(if (on) "Disable" else "Enable", if (on) "circle-slash" else "play", { close(); toggleJob(hub, j, !on) })
    MenuSeparator()
    MenuItem("Delete", "trash", { close(); deleteJob(actions, j) }, danger = true)
}

@Composable
fun JobsListPage(hub: Hub, st: CodexState, profile: String?, now: Long, actions: TaskActions, onAutopilot: () -> Unit, onNew: (Row) -> Unit, onOpen: (Row) -> Unit) {
    val haptic = LocalHapticFeedback.current
    val add = { preset: JobPreset? -> newJob(profile ?: WORK, preset, System.currentTimeMillis()).let { if (hub.codex.add(it)) onNew(it) } }
    val jobs = remember(st.jobs, profile) { jobsOf(st.jobs, profile) }
    val byJob = remember(st.runs) { runsByJob(st.runs) }
    val waiting = remember(st.items, profile, now / 60_000) { replyQueue(split(st.items, profile, now).asks, profile, now).size }
    LazyColumn(Modifier.fillMaxWidth()) {
        if (!hub.readOnly) item { Button("New job", { add(null) }, Modifier.padding(start = Tokens.listPad, top = Tokens.sp4), size = ButtonSize.Sm, icon = "add") }
        item { AutopilotRow(hub, waiting, onAutopilot) }
        if (jobs.isEmpty()) {
            item { EmptyState("No jobs yet", "A job runs a prompt on a schedule, can add tasks, and sends you the result", icon = "history") }
            if (!hub.readOnly) item { Button("Weekly digest", { add(WEEKLY_DIGEST) }, Modifier.padding(start = Tokens.listPad), size = ButtonSize.Sm, icon = "sparkle") }
        } else item {
            Group {
                jobs.forEachIndexed { i, j ->
                    if (i > 0) Hairline()
                    val own = byJob.of(j)
                    val state = jobState(j, own, now)
                    val menu = remember(j.key) { mutableStateOf(false) }
                    ListRow(j.str("name")?.ifEmpty { null } ?: "Untitled job", listOfNotNull(jobMeta(j, own, st.paused, now), if (profile == null) profileLabel(j.profile) else null).joinToString(" · "), onClick = { onOpen(j) },
                        onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); menu.value = true },
                        trailing = {
                            if (state != null) StateBadge(state)
                            MoreButton(expanded = menu) { close -> JobMenu(hub, actions, j, canRunNow(j, own, now), close) }
                        })
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

private const val TASKS_SHOWN = 5

fun mcpToolId(server: String) = toolId(server, "*")

fun toolLabels(tools: String, servers: List<String> = emptyList()): List<String> = toolIds(tools).map { id ->
    if (id == "browser") "Chrome" else servers.firstOrNull { mcpToolId(it) == id } ?: id
}

@Composable
fun JobPageView(hub: Hub, st: CodexState, job: Row, now: Long, actions: TaskActions, startEditing: Boolean, onTask: (Row) -> Unit) {
    val runs = remember(st.runs, job.key) { runsOf(st.runs, job) }
    val tasks = remember(st.items, job.key, job.str("name")) { tasksOf(st.items, job) }
    val state = jobState(job, runs, now)
    var runsOpen by rememberSaveable(job.key) { mutableStateOf(false) }
    var allTasks by rememberSaveable(job.key) { mutableStateOf(false) }
    var editing by rememberSaveable(job.key) { mutableStateOf(startEditing) }
    var scheduling by remember(job.key) { mutableStateOf(false) }
    var pickingTools by remember(job.key) { mutableStateOf(false) }
    var pickingRepo by remember(job.key) { mutableStateOf(false) }
    val tools = job.str("tools")?.takeIf { it.isNotBlank() }
    var probe by remember(job.key) { mutableStateOf<List<McpServer>?>(null) }
    var probeFailed by remember(job.key) { mutableStateOf(false) }
    LaunchedEffect(job.key) { runCatching { hub.mcpProbe(false) }.onSuccess { probe = it }.onFailure { probeFailed = true } }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Text(job.str("name")?.ifEmpty { null } ?: "Untitled job", Modifier.padding(start = Tokens.sp8, end = Tokens.sp4, top = Tokens.sp4), style = Type.title)
            SectionHeader("${profileLabel(job.profile)} account", action = {
                if (state != null) StateBadge(state)
                Button("Run now", { runJobNow(hub, actions, job) }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, icon = "play", enabled = canRunNow(job, runs, now) && !hub.readOnly)
                MoreButton { close -> JobMenu(hub, actions, job, canRunNow(job, runs, now), close, onEdit = { editing = true }) }
            })
        }
        item { SectionHeader("Prompt") }
        item { Group { Text(job.str("prompt")?.ifEmpty { null } ?: "No prompt", Modifier.fillMaxWidth().clickable { editing = true }.padding(horizontal = Tokens.listPad, vertical = Tokens.sp5), style = Type.body, color = av.fg) } }
        item {
            Group(Modifier.padding(top = Tokens.sp4)) {
                ListRow("When", jobMeta(job, runs, st.paused, now), onClick = if (hub.readOnly) null else ({ scheduling = true }), trailing = if (hub.readOnly) null else ({ Chevron() })); Hairline()
                ListRow("Repo", repoLabel(job.str("repo")) ?: "None", onClick = if (hub.readOnly) null else ({ pickingRepo = true }), trailing = if (hub.readOnly) null else ({ Chevron() })); Hairline()
                if (job.str("repo") == null) { ListRow("Only push when it found something", "A reply starting with NOTHING NEW is kept in the runs but not pushed", toggle = Toggle(job.long("quiet") == 1L) { hub.codex.update(job, mapOf("quiet" to if (it) 1 else 0)) }); Hairline() }
                if (job.str("repo") == null) {
                    ListRow("Allowed tools", tools?.let { toolLabels(it, probe.orEmpty().map { s -> s.name }).joinToString(", ") } ?: "None", onClick = if (hub.readOnly) null else ({ pickingTools = true }), trailing = if (hub.readOnly) null else ({ Chevron() }))
                    Hairline()
                }
                val latest = runs.firstOrNull()
                if (latest == null) ListRow("Runs", "Not run yet")
                else ListRow("Runs", runTime(latest, now), onClick = { runsOpen = true }, trailing = { RunStatus(latest.str("status") ?: ""); Chevron() })
            }
            repoLabel(job.str("repo"))?.let { Footnote("Runs in a new worktree of $it on the hub's Mac. Nothing is pushed until you approve it.") }
        }
        if (tasks.isNotEmpty()) {
            item { SectionHeader("Tasks it added", tasks.size.toString()) }
            item {
                Group {
                    (if (allTasks) tasks else tasks.take(TASKS_SHOWN)).forEachIndexed { i, t ->
                        if (i > 0) Hairline()
                        ListRow(t.title ?: UNTITLED, listOfNotNull(if (t.status == "done") "Done" else null, agoText(t.madeAt, now)).joinToString(" · "), strike = t.status == "done", onClick = { onTask(t) })
                    }
                }
                if (!allTasks && tasks.size > TASKS_SHOWN) Button("Show all ${tasks.size}", { allTasks = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
    if (editing) JobEditSheet(actions, job) { editing = false }
    if (scheduling) JobScheduleSheet(actions, job) { scheduling = false }
    if (pickingTools) JobToolsSheet(hub, job, probe, probeFailed) { pickingTools = false }
    if (pickingRepo) JobRepoSheet(hub, job) { pickingRepo = false }
    val ask: ((Row, String) -> Unit)? = if (hub.readOnly) null else ({ r, output ->
        runsOpen = false
        hub.askCodex(runAsk(job.str("name")?.ifEmpty { null } ?: "Untitled job", r.long("started_at") ?: 0L, output), job.profile)
    })
    if (runsOpen) RunsSheet(runs, now, { hub.notice.value = it }, ask) { runsOpen = false }
}

@Composable
private fun RunStatus(status: String) = when (status) {
    "ok" -> Badge("Succeeded", BadgeTone.Done)
    "running" -> Badge("Running", BadgeTone.Running)
    else -> Badge("Failed", BadgeTone.Failed)
}

@Composable
private fun RunsSheet(runs: List<Row>, now: Long, say: (String) -> Unit, ask: ((Row, String) -> Unit)?, onDismiss: () -> Unit) {
    val shown = runs.take(10)
    var open by remember { mutableStateOf(shown.firstOrNull()?.id) }
    val clip = LocalClipboardManager.current
    Sheet(onDismiss, "Runs", padded = false, count = shown.size.toString()) {
        Group {
            shown.forEachIndexed { i, r ->
                if (i > 0) Hairline()
                val output = r.str("output")?.ifEmpty { null }
                val expanded = output != null && open == r.id
                ListRow(runTime(r, now) ?: "Run", runMeta(r).ifEmpty { null },
                    onClick = if (output != null) ({ open = if (expanded) null else r.id }) else null,
                    trailing = { RunStatus(r.str("status") ?: ""); if (output != null) Chevron() })
                if (expanded && output != null) {
                    LayoutRow(Modifier.padding(start = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                        Button("Copy output", { clip.setText(AnnotatedString(output)); say("Output copied") }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, icon = "copy")
                        if (ask != null) Button("Ask Claude", { ask(r, output) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, icon = "sparkle")
                    }
                    if (i == 0) SearchedOutput(output)
                    else Markdown(output, OutputPad)
                }
            }
        }
    }
}

private val OutputPad = Modifier.padding(start = Tokens.sp8, end = Tokens.sp8, bottom = Tokens.sp6)

// The latest run's output with a search, as the meeting transcript has: every match marked, Previous and Next bring the current one into view.
// A blank query shows the output as Markdown.
@Composable
private fun SearchedOutput(output: String) {
    var query by remember { mutableStateOf("") }
    var cur by remember { mutableStateOf(-1) }
    val lines = remember(output, query) { queryWords(query).let { words -> output.lines().map { markSegments(it, words) } } }
    val starts = lines.runningFold(0) { n, line -> n + line.count { it.hit } }
    val count = starts.last()
    val views = remember(lines.size) { List(lines.size) { BringIntoViewRequester() } }
    val scope = rememberCoroutineScope()
    fun step(dir: Int) {
        val n = stepMatch(cur, dir, count)
        cur = n
        scope.launch { views[starts.indexOfLast { it <= n }].bringIntoView() }
    }
    SearchField(query, { query = it; cur = -1 }, "Search output")
    if (query.isNotBlank()) LayoutRow(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad), verticalAlignment = Alignment.CenterVertically) {
        Text(matchLabel(count), Modifier.weight(1f), style = Type.subheadline, color = av.fgMuted)
        IconBtn("arrow-up", "Previous match", { step(-1) }, enabled = count > 0)
        IconBtn("arrow-down", "Next match", { step(1) }, enabled = count > 0)
    }
    if (query.isBlank()) return Markdown(output, OutputPad)
    val soft = SpanStyle(background = av.accentSoft)
    val strong = SpanStyle(background = av.primaryContainer, color = av.onPrimaryContainer)
    Column(OutputPad) {
        lines.forEachIndexed { i, line ->
            var k = 0
            val shown = buildAnnotatedString {
                for (s in line) if (s.hit) withStyle(if (starts[i] + k++ == cur) strong else soft) { append(s.text) } else append(s.text)
            }
            Text(shown, Modifier.bringIntoViewRequester(views[i]), style = Type.body, color = av.fg)
        }
    }
}

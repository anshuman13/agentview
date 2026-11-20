package no.pradhan.agentview.nativeapp.codex.jobs

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.Row
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
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
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

private fun runJobNow(hub: Hub, actions: TaskActions, j: Row) {
    if (hub.codex.update(j, mapOf("next_run_at" to System.currentTimeMillis()))) actions.say("Starts within a minute")
}

private fun deleteJob(actions: TaskActions, j: Row) = actions.change(j, mapOf("deleted" to true), "Deleted ${j.str("name")?.ifEmpty { null } ?: "job"}")

@Composable
private fun JobMenu(hub: Hub, actions: TaskActions, j: Row, canRun: Boolean, close: () -> Unit) {
    val on = isEnabled(j)
    MenuItem("Run now", "play", { close(); runJobNow(hub, actions, j) }, enabled = canRun)
    MenuItem(if (on) "Disable" else "Enable", if (on) "circle-slash" else "play", { close(); toggleJob(hub, j, !on) })
    MenuSeparator()
    MenuItem("Delete", "trash", { close(); deleteJob(actions, j) }, danger = true)
}

@Composable
fun JobsListPage(hub: Hub, st: CodexState, profile: String?, now: Long, actions: TaskActions, onAutopilot: () -> Unit, onOpen: (Row) -> Unit) {
    val haptic = LocalHapticFeedback.current
    val jobs = remember(st.jobs, profile) { jobsOf(st.jobs, profile) }
    val byJob = remember(st.runs) { runsByJob(st.runs) }
    val waiting = remember(st.items, profile, now / 60_000) { replyQueue(split(st.items, profile, now).asks, profile, now).size }
    LazyColumn(Modifier.fillMaxWidth()) {
        item { AutopilotRow(hub, waiting, onAutopilot) }
        if (jobs.isEmpty()) item { EmptyState("No jobs yet", "A job runs a prompt on a schedule, can add tasks, and sends you the result", icon = "history") }
        else item {
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

fun mcpToolId(server: String) = "mcp__${server.replace(Regex("[^A-Za-z0-9_-]"), "_")}__*"

fun toolLabels(tools: String, servers: List<String> = emptyList()): List<String> = tools.split(',').map { it.trim() }.filter { it.isNotEmpty() }.map { id ->
    if (id == "browser") "Chrome" else servers.firstOrNull { mcpToolId(it) == id } ?: id
}

@Composable
fun JobPageView(hub: Hub, st: CodexState, job: Row, now: Long, actions: TaskActions, onTask: (Row) -> Unit) {
    val runs = remember(st.runs, job.key) { runsOf(st.runs, job) }
    val tasks = remember(st.items, job.key, job.str("name")) { tasksOf(st.items, job) }
    val state = jobState(job, runs, now)
    var runsOpen by rememberSaveable(job.key) { mutableStateOf(false) }
    var allTasks by rememberSaveable(job.key) { mutableStateOf(false) }
    val tools = job.str("tools")?.takeIf { it.isNotBlank() }
    var servers by remember { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(tools) { if (tools != null) runCatching { servers = hub.mcpProbe(false).map { it.name } } }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Text(job.str("name")?.ifEmpty { null } ?: "Untitled job", Modifier.padding(start = Tokens.sp8, end = Tokens.sp4, top = Tokens.sp4), style = Type.title)
            SectionHeader("${profileLabel(job.profile)} account", action = {
                if (state != null) StateBadge(state)
                Button("Run now", { runJobNow(hub, actions, job) }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, icon = "play", enabled = canRunNow(job, runs, now))
                MoreButton { close -> JobMenu(hub, actions, job, canRunNow(job, runs, now), close) }
            })
        }
        item { SectionHeader("Prompt") }
        item { Group { Text(job.str("prompt")?.ifEmpty { null } ?: "No prompt", Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp5), style = Type.body, color = av.fg) } }
        item {
            Group(Modifier.padding(top = Tokens.sp4)) {
                ListRow("When", jobMeta(job, runs, st.paused, now)); Hairline()
                repoLabel(job.str("repo"))?.let { ListRow("Repo", it); Hairline() }
                if (job.str("repo") == null) { ListRow("Only push when it found something", "A reply starting with NOTHING NEW is not pushed", trailing = { Toggle(job.long("quiet") == 1L) { hub.codex.update(job, mapOf("quiet" to if (it) 1 else 0)) } }); Hairline() }
                if (tools != null) { ListRow("Tools", toolLabels(tools, servers).joinToString(", ")); Hairline() }
                val latest = runs.firstOrNull()
                if (latest == null) ListRow("Runs", "Not run yet")
                else ListRow("Runs", runTime(latest), onClick = { runsOpen = true }, trailing = { RunStatus(latest.str("status") ?: ""); Chevron() })
            }
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
    if (runsOpen) RunsSheet(runs, { hub.notice.value = it }) { runsOpen = false }
}

@Composable
private fun RunStatus(status: String) = when (status) {
    "ok" -> Badge("Done", BadgeTone.Done)
    "running" -> Badge("Running", BadgeTone.Running)
    else -> Badge("Failed", BadgeTone.Failed)
}

@Composable
private fun RunsSheet(runs: List<Row>, say: (String) -> Unit, onDismiss: () -> Unit) {
    val shown = runs.take(10)
    var open by remember { mutableStateOf(shown.firstOrNull()?.id) }
    val clip = LocalClipboardManager.current
    Sheet(onDismiss, "Runs", padded = false, count = shown.size.toString()) {
        Group {
            shown.forEachIndexed { i, r ->
                if (i > 0) Hairline()
                val output = r.str("output")?.ifEmpty { null }
                val expanded = output != null && open == r.id
                ListRow(runTime(r) ?: "Run", runMeta(r).ifEmpty { null },
                    onClick = if (output != null) ({ open = if (expanded) null else r.id }) else null,
                    trailing = { RunStatus(r.str("status") ?: ""); if (output != null) Chevron() })
                if (expanded && output != null) {
                    Button("Copy output", { clip.setText(AnnotatedString(output)); say("Output copied") }, Modifier.padding(start = Tokens.sp4), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                    Text(output, Modifier.padding(start = Tokens.sp8, end = Tokens.sp8, bottom = Tokens.sp6), style = Type.body, color = av.fg)
                }
            }
        }
    }
}

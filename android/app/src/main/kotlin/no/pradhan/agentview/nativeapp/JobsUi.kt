package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row as LayoutRow
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString

@Composable
private fun StateBadge(state: JobState) = when (state) {
    JobState.Running -> Badge("Running", BadgeTone.Running)
    JobState.Queued -> Badge("Waiting", BadgeTone.Waiting)
    JobState.Failed -> Badge("Failed", BadgeTone.Failed)
    JobState.Off -> Badge("Skipped", BadgeTone.Quiet)
}

fun toggleJob(hub: Hub, j: Row, on: Boolean) = hub.codex.update(j, mapOf("enabled" to if (on) 1 else 0, "next_run_at" to null))

@Composable
fun JobsListPage(hub: Hub, st: CodexState, profile: String?, now: Long, onAutopilot: () -> Unit, onOpen: (Row) -> Unit) {
    val jobs = remember(st.jobs, profile) { jobsOf(st.jobs, profile) }
    val waiting = remember(st.items, profile, now / 60_000) { replyQueue(split(st.items, profile, now).review, profile, now).size }
    LazyColumn(Modifier.fillMaxWidth()) {
        item { AutopilotRow(hub, waiting, onAutopilot) }
        if (jobs.isEmpty()) item { EmptyState("No jobs yet", "A job runs a prompt on a schedule, can add tasks, and sends you the result") }
        else item {
            Group(Modifier.padding(top = Tokens.sp4)) {
                jobs.forEachIndexed { i, j ->
                    if (i > 0) Hairline()
                    val state = jobState(j, st.runs, now)
                    ListRow(j.str("name")?.ifEmpty { null } ?: "Untitled job", listOfNotNull(jobMeta(j, st.runs, now), if (profile == null) profileLabel(j.profile) else null).joinToString(" · "), onClick = { onOpen(j) },
                        trailing = {
                            if (state != null) StateBadge(state)
                            Toggle(isEnabled(j), { toggleJob(hub, j, it) })
                        })
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

fun mcpToolId(server: String) = "mcp__${server.replace(Regex("[^A-Za-z0-9_-]"), "_")}__*"

fun toolLabels(tools: String, servers: List<String> = emptyList()): List<String> = tools.split(',').map { it.trim() }.filter { it.isNotEmpty() }.map { id ->
    if (id == "browser") "Chrome" else servers.firstOrNull { mcpToolId(it) == id } ?: id
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JobPageView(hub: Hub, st: CodexState, job: Row, now: Long) {
    val runs = remember(st.runs, job.key) { runsOf(st.runs, job) }
    val state = jobState(job, st.runs, now)
    var runsOpen by rememberSaveable(job.key) { mutableStateOf(false) }
    val tools = job.str("tools")?.takeIf { it.isNotBlank() }
    var servers by remember { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(tools) { if (tools != null) runCatching { servers = parseMcp(hub.read("/api/mcp/probe")).map { it.name } } }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Text(job.str("name")?.ifEmpty { null } ?: "Untitled job", Modifier.padding(start = Tokens.sp8, end = Tokens.sp4, top = Tokens.sp4), style = Type.title)
            LayoutRow(Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                Text(listOfNotNull(describeSchedule(job.str("schedule")), profileLabel(job.profile)).joinToString(" · "), style = Type.subheadline, color = av.fgMuted)
                if (state != null) StateBadge(state)
            }
        }
        item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Enabled", jobMeta(job, st.runs, now), trailing = { Toggle(isEnabled(job), { toggleJob(hub, job, it) }) }) } }
        item { SectionHeader("Prompt") }
        item { Text(job.str("prompt")?.ifEmpty { null } ?: "No prompt", Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fg) }
        if (tools != null) {
            item { SectionHeader("Tools") }
            item {
                FlowRow(Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    toolLabels(tools, servers).forEach { Chip(it, null) }
                }
            }
        }
        item {
            Group(Modifier.padding(top = Tokens.sp6)) {
                val latest = runs.firstOrNull()
                if (latest == null) ListRow("Runs", "Not run yet")
                else ListRow("Runs", runTime(latest), onClick = { runsOpen = true }, trailing = { RunStatus(latest.str("status") ?: ""); Chevron() })
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
    Sheet(onDismiss, padded = false) {
        SectionHeader("Runs", shown.size.toString())
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

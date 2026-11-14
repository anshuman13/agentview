package no.pradhan.agentview.nativeapp.codex.jobs

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import no.pradhan.agentview.nativeapp.codex.CodexState
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.autopilot.AutopilotRow
import no.pradhan.agentview.nativeapp.codex.profileLabel
import no.pradhan.agentview.nativeapp.codex.replyQueue
import no.pradhan.agentview.nativeapp.codex.split
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.net.mcpProbe
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

@Composable
fun JobsListPage(hub: Hub, st: CodexState, profile: String?, now: Long, onAutopilot: () -> Unit, onOpen: (Row) -> Unit) {
    val haptic = LocalHapticFeedback.current
    val jobs = remember(st.jobs, profile) { jobsOf(st.jobs, profile) }
    val byJob = remember(st.runs) { runsByJob(st.runs) }
    val waiting = remember(st.items, profile, now / 60_000) { replyQueue(split(st.items, profile, now).review, profile, now).size }
    LazyColumn(Modifier.fillMaxWidth()) {
        item { AutopilotRow(hub, waiting, onAutopilot) }
        if (jobs.isEmpty()) item { EmptyState("No jobs yet", "Runs a prompt on a schedule") }
        else item {
            Group {
                jobs.forEachIndexed { i, j ->
                    if (i > 0) Hairline()
                    val own = byJob.of(j)
                    val state = jobState(j, own, now)
                    val menu = remember(j.key) { mutableStateOf(false) }
                    ListRow(j.str("name")?.ifEmpty { null } ?: "Untitled job", listOfNotNull(jobMeta(j, own, now), if (profile == null) profileLabel(j.profile) else null).joinToString(" · "), onClick = { onOpen(j) },
                        onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); menu.value = true },
                        trailing = {
                            if (state != null) StateBadge(state)
                            MoreButton(expanded = menu) { close ->
                                val on = isEnabled(j)
                                MenuItem(if (on) "Disable" else "Enable", if (on) "circle-slash" else "play", { close(); toggleJob(hub, j, !on) })
                                MenuItem("Open", "arrow-right", { close(); onOpen(j) })
                            }
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

// The folder name of a job's repo, or null for a job that only reads.
fun repoName(repo: String?): String? = repo?.trimEnd('/')?.substringAfterLast('/')?.ifEmpty { null }

@Composable
fun JobPageView(hub: Hub, st: CodexState, job: Row, now: Long) {
    val runs = remember(st.runs, job.key) { runsOf(st.runs, job) }
    val state = jobState(job, runs, now)
    var runsOpen by rememberSaveable(job.key) { mutableStateOf(false) }
    val tools = job.str("tools")?.takeIf { it.isNotBlank() }
    var servers by remember { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(tools) { if (tools != null) runCatching { servers = hub.mcpProbe(false).map { it.name } } }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Text(job.str("name")?.ifEmpty { null } ?: "Untitled job", Modifier.padding(start = Tokens.sp8, end = Tokens.sp4, top = Tokens.sp4), style = Type.title)
            LayoutRow(Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                Text(listOfNotNull(describeSchedule(job.str("schedule")), profileLabel(job.profile)).joinToString(" · "), style = Type.subheadline, color = av.fgMuted)
                if (state != null) StateBadge(state)
            }
        }
        item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Enabled", jobMeta(job, runs, now), trailing = { Toggle(isEnabled(job)) { toggleJob(hub, job, it) } }) } }
        item { SectionHeader("Prompt") }
        item { Group { Text(job.str("prompt")?.ifEmpty { null } ?: "No prompt", Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp5), style = Type.body, color = av.fg) } }
        item {
            Group(Modifier.padding(top = Tokens.sp4)) {
                repoName(job.str("repo"))?.let { ListRow("Repo", it); Hairline() }
                if (tools != null) { ListRow("Tools", toolLabels(tools, servers).joinToString(", ")); Hairline() }
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

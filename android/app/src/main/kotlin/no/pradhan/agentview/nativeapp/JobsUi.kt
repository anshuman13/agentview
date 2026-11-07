package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString

@Composable
private fun JobState.color(): Color? = when (this) { JobState.Running -> av.ok; JobState.Queued -> av.warn; JobState.Failed -> av.err; JobState.Off -> av.fgFaint }

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
                            if (state != null && state != JobState.Off) RowLabel(state.label, state.color() ?: av.fgMuted)
                            Toggle(isEnabled(j), { toggleJob(hub, j, it) })
                        })
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

@Composable
fun JobPageView(hub: Hub, st: CodexState, job: Row, now: Long) {
    val runs = remember(st.runs, job.key) { runsOf(st.runs, job) }
    val state = jobState(job, st.runs, now)
    var runsOpen by rememberSaveable(job.key) { mutableStateOf(false) }
    val tools = job.str("tools")?.takeIf { it.isNotBlank() }
    LazyColumn(Modifier.fillMaxWidth()) {
        item {
            Text(job.str("name")?.ifEmpty { null } ?: "Untitled job", Modifier.padding(start = Tokens.sp8, end = Tokens.sp4, top = Tokens.sp4), style = Type.title)
            Text(listOfNotNull(describeSchedule(job.str("schedule")), profileLabel(job.profile), state?.label).joinToString(" · "), Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.subheadline, color = state?.color() ?: av.fgMuted)
        }
        item { Group(Modifier.padding(top = Tokens.sp4)) { ListRow("Enabled", jobMeta(job, st.runs, now), trailing = { Toggle(isEnabled(job), { toggleJob(hub, job, it) }) }) } }
        item { SectionHeader("Prompt") }
        item { Text(job.str("prompt")?.ifEmpty { null } ?: "No prompt", Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fg) }
        if (tools != null) {
            item { SectionHeader("Tools") }
            item { Text(tools, Modifier.padding(horizontal = Tokens.sp8, vertical = Tokens.sp2), style = Type.body, color = av.fgMuted) }
        }
        item {
            Group(Modifier.padding(top = Tokens.sp6)) {
                val latest = runs.firstOrNull()
                if (latest == null) ListRow("Runs", "Not run yet")
                else ListRow("Runs", latest.long("started_at")?.let { "${weekdayDate(it)} ${clock(it)}" }, onClick = { runsOpen = true }, trailing = { RunStatus(latest.str("status") ?: ""); Chevron() })
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
    if (runsOpen) RunsSheet(runs) { runsOpen = false }
}

@Composable
private fun RunStatus(status: String) = RowLabel(
    if (status == "ok") "Succeeded" else status,
    if (status == "error") av.err else if (status == "running" || status == "ok") av.ok else av.fgMuted,
)

@Composable
private fun RunsSheet(runs: List<Row>, onDismiss: () -> Unit) {
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
                ListRow(r.long("started_at")?.let { "${weekdayDate(it)} ${clock(it)}" } ?: "Run", runMeta(r).ifEmpty { null },
                    onClick = if (output != null) ({ open = if (expanded) null else r.id }) else null,
                    trailing = { RunStatus(r.str("status") ?: ""); if (output != null) Chevron() })
                if (expanded) {
                    Text(output!!, Modifier.padding(horizontal = Tokens.sp8), style = Type.subheadline, color = av.fgMuted)
                    Button("Copy output", { clip.setText(AnnotatedString(output)) }, Modifier.padding(start = Tokens.sp4), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                }
            }
        }
    }
}

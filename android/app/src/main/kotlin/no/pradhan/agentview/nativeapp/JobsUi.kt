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

@Composable
private fun JobState.color(): Color? = when (this) { JobState.Running -> av.ok; JobState.Queued -> av.warn; JobState.Failed -> av.err; JobState.Off -> av.fgFaint }

fun toggleJob(hub: Hub, j: Row, on: Boolean) = hub.codex.update(j, mapOf("enabled" to if (on) 1 else 0, "next_run_at" to null))

@Composable
fun JobsListPage(hub: Hub, st: CodexState, profile: String?, now: Long, onAutopilot: () -> Unit, onOpen: (Row) -> Unit) {
    val jobs = remember(st.jobs, profile) { jobsOf(st.jobs, profile) }
    val waiting = remember(st.items, profile, now / 60_000) { replyQueue(st.items, profile, now).size }
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
    var openRun by rememberSaveable(job.key) { mutableStateOf<String?>(null) }
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
        item { SectionHeader("Runs", runs.size.toString()) }
        if (runs.isEmpty()) item { EmptyState("No runs yet") }
        else item {
            Group {
                runs.take(10).forEachIndexed { i, r ->
                    if (i > 0) Hairline()
                    val status = r.str("status") ?: ""
                    ListRow(r.long("started_at")?.let { "${weekdayDate(it)} ${clock(it)}" } ?: "Run", runMeta(r), onClick = { openRun = if (openRun == r.id) null else r.id },
                        trailing = { Text(status, style = Type.label, color = if (status == "error") av.err else if (status == "running") av.ok else av.fgMuted, modifier = Modifier.padding(end = Tokens.sp4)) })
                    if (openRun == r.id) Text(r.str("output")?.ifEmpty { null } ?: "No output", Modifier.padding(start = Tokens.sp8, end = Tokens.sp8, bottom = Tokens.sp4), style = Type.subheadline, color = av.fgMuted)
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
fun JobsListPage(hub: Hub, st: CodexState, profile: String?, now: Long, onOpen: (Row) -> Unit) {
    val jobs = remember(st.jobs, profile) { jobsOf(st.jobs, profile) }
    LazyColumn(Modifier.fillMaxWidth()) {
        if (jobs.isEmpty()) item { Empty("No jobs yet", "A job runs a prompt on a schedule, can add tasks, and sends you the result") }
        else item {
            Group(Modifier.padding(top = Sp.s4)) {
                jobs.forEachIndexed { i, j ->
                    if (i > 0) Hairline()
                    val state = jobState(j, st.runs, now)
                    PlainRow(j.str("name")?.ifEmpty { null } ?: "Untitled job", listOfNotNull(jobMeta(j, st.runs, now), if (profile == null) profileLabel(j.profile) else null).joinToString(" · "), onClick = { onOpen(j) },
                        trailing = {
                            if (state != null && state != JobState.Off) Text(state.label, style = MaterialTheme.typography.labelSmall, color = state.color() ?: av.fgMuted, modifier = Modifier.padding(end = Sp.s4))
                            Switch(isEnabled(j), { toggleJob(hub, j, it) })
                        })
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Sp.s16)) }
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
            Text(job.str("name")?.ifEmpty { null } ?: "Untitled job", Modifier.padding(start = Sp.s8, end = Sp.s4, top = Sp.s4), style = MaterialTheme.typography.titleLarge)
            Text(listOfNotNull(describeSchedule(job.str("schedule")), profileLabel(job.profile), state?.label).joinToString(" · "), Modifier.padding(horizontal = Sp.s8, vertical = Sp.s2), style = MaterialTheme.typography.labelMedium, color = state?.color() ?: av.fgMuted)
        }
        item { Group(Modifier.padding(top = Sp.s4)) { PlainRow("Enabled", jobMeta(job, st.runs, now), trailing = { Switch(isEnabled(job), { toggleJob(hub, job, it) }) }) } }
        item { SectionHeader("Prompt") }
        item { Text(job.str("prompt")?.ifEmpty { null } ?: "No prompt", Modifier.padding(horizontal = Sp.s8, vertical = Sp.s2), style = MaterialTheme.typography.bodyMedium, color = av.fg) }
        if (tools != null) {
            item { SectionHeader("Tools") }
            item { Text(tools, Modifier.padding(horizontal = Sp.s8, vertical = Sp.s2), style = MaterialTheme.typography.bodyMedium, color = av.fgMuted) }
        }
        item { SectionHeader("Runs", runs.size.toString()) }
        if (runs.isEmpty()) item { Empty("No runs yet") }
        else item {
            Group {
                runs.take(10).forEachIndexed { i, r ->
                    if (i > 0) Hairline()
                    val status = r.str("status") ?: ""
                    PlainRow(r.long("started_at")?.let { "${weekdayDate(it)} ${clock(it)}" } ?: "Run", runMeta(r), onClick = { openRun = if (openRun == r.id) null else r.id },
                        trailing = { Text(status, style = MaterialTheme.typography.labelSmall, color = if (status == "error") av.err else if (status == "running") av.ok else av.fgMuted, modifier = Modifier.padding(end = Sp.s4)) })
                    if (openRun == r.id) Text(r.str("output")?.ifEmpty { null } ?: "No output", Modifier.padding(start = Sp.s8, end = Sp.s8, bottom = Sp.s4), style = MaterialTheme.typography.bodySmall, color = av.fgMuted)
                }
            }
        }
        item { Spacer(Modifier.padding(bottom = Sp.s16)) }
    }
}

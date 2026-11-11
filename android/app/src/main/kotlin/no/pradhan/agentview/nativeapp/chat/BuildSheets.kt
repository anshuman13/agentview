package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.codex.autopilot.openChatOf
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.ops.DiffFiles
import no.pradhan.agentview.nativeapp.sessions.BuildCommit
import no.pradhan.agentview.nativeapp.sessions.BuildDetail
import no.pradhan.agentview.nativeapp.sessions.BuildEntry
import no.pradhan.agentview.nativeapp.sessions.BuildReview
import no.pradhan.agentview.nativeapp.sessions.CommitDiff
import no.pradhan.agentview.nativeapp.sessions.StageRow
import no.pradhan.agentview.nativeapp.sessions.criterionBadge
import no.pradhan.agentview.nativeapp.sessions.decisionTitle
import no.pradhan.agentview.nativeapp.sessions.nextPhase
import no.pradhan.agentview.nativeapp.sessions.phaseApproved
import no.pradhan.agentview.nativeapp.sessions.phaseLabel
import no.pradhan.agentview.nativeapp.sessions.reviewDecision
import no.pradhan.agentview.nativeapp.sessions.stageBadge
import no.pradhan.agentview.nativeapp.sessions.stageMeta
import no.pradhan.agentview.nativeapp.sessions.stageTitle
import no.pradhan.agentview.nativeapp.sessions.startPhase
import no.pradhan.agentview.nativeapp.sessions.stateBadge
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.PrFile
import no.pradhan.agentview.nativeapp.workspace.agoShort
import no.pradhan.agentview.nativeapp.workspace.runAllPrompt
import no.pradhan.agentview.nativeapp.workspace.specProgress
import no.pradhan.agentview.nativeapp.workspace.specTasks
import no.pradhan.agentview.nativeapp.workspace.startTaskPrompt
import no.pradhan.agentview.nativeapp.workspace.withoutOpenTasks

private const val BUILDS_POLL_MS = 15_000L

// Reloads every 15 s while `running`.
@Composable
internal fun PollWhile(running: Boolean, reload: () -> Unit) {
    LaunchedEffect(running) { while (running) { delay(BUILDS_POLL_MS); reload() } }
}

@Composable
internal fun LoadFailed(what: String, reload: () -> Unit) {
    EmptyState("Could not load $what", "Try again", action = { Button("Retry", reload, size = ButtonSize.Sm) })
}

internal class Report(val title: String, val text: String, val chat: String? = null, val session: String = "")

internal class TaskRun(val path: String, val send: (String) -> Unit)

internal fun LazyListScope.stageItems(rows: List<StageRow>, now: Long, showReport: (Report) -> Unit) {
    item { SectionHeader("Stages", rows.size.toString()) }
    item {
        Group {
            rows.forEachIndexed { i, r ->
                if (i > 0) Hairline()
                val e = r.entry
                val y = r.review
                if (e != null) {
                    val (label, tone) = stageBadge(e)
                    ListRow(stageTitle(e), stageMeta(e).ifEmpty { agoShort(e.startedAt, now, " ago") }, trailing = { Badge(label, tone) }, onClick = { showReport(Report(stageTitle(e), e.report, e.chat, e.session.orEmpty())) })
                } else if (y != null) {
                    val (label, tone) = stateBadge(if (y.decision == "approve") "done" else "waiting")
                    ListRow("You · ${phaseLabel(y.phase)}", y.note.ifEmpty { agoShort(y.at, now, " ago") }, metaLines = 2, trailing = { Badge(label, tone) }, onClick = { showReport(Report("You · ${phaseLabel(y.phase)}", y.note.ifEmpty { decisionTitle(y) })) })
                }
            }
        }
    }
}

internal fun LazyListScope.implementationItems(c: BuildCommit, diff: CommitDiff, openFile: String?, openDiff: (String?) -> Unit) {
    val files = diff.files.map { PrFile(it.path, it.add, it.del) }
    item { SectionHeader("Implementation") }
    item {
        Group {
            ListRow(c.branch ?: c.subject, "${c.sha.take(7)} · ${files.size} ${if (files.size == 1) "file" else "files"} +${files.sumOf { it.additions }} -${files.sumOf { it.deletions }}")
            if (files.isNotEmpty()) Hairline()
            DiffFiles(files, diff.diff, openFile, openDiff)
        }
    }
}

internal fun LazyListScope.testItems(test: BuildEntry) {
    item {
        SectionHeader("Tests", action = {
            val passed = test.criteria.count { it.result == "pass" }
            val failed = test.criteria.count { it.result == "fail" }
            if (passed > 0) Badge("$passed passed", BadgeTone.Done)
            if (failed > 0) Badge("$failed failed", BadgeTone.Failed)
        })
    }
    item {
        Group {
            if (test.criteria.isEmpty()) ListRow("No per-criterion lines in the report")
            test.criteria.forEachIndexed { i, c ->
                if (i > 0) Hairline()
                val (label, tone) = criterionBadge(c)
                ListRow(c.n.toString(), c.evidence, metaLines = 2, trailing = { Badge(label, tone) })
            }
        }
    }
}

internal fun LazyListScope.codeReviewItems(d: BuildDetail, review: BuildEntry?, hasCommit: Boolean, now: Long, readOnly: Boolean, approve: () -> Unit, askChanges: () -> Unit) {
    item { SectionHeader("Code review") }
    item {
        Group {
            if (review != null && review.findings.isEmpty()) ListRow("Clean")
            review?.findings?.forEachIndexed { i, f ->
                if (i > 0) Hairline()
                ListRow(f, lines = 2)
            }
            if (hasCommit) {
                if (review != null) Hairline()
                DecisionRow(d.codeReview, now, readOnly, approve, askChanges)
            }
        }
    }
}

@Composable
internal fun ReportSheet(hub: Hub, scope: CoroutineScope, r: Report, onDismiss: () -> Unit) {
    Sheet(onDismiss, r.title) {
        if (r.text.isBlank()) EmptyState("No report yet") else Markdown(r.text, Modifier.padding(bottom = Tokens.sp6))
        if (r.chat != null) Button("Open chat", { scope.launch { if (hub.openChatOf(r.chat, r.session)) { hub.link.value = DeepLink(view = "agents"); onDismiss() } } }, Modifier.padding(bottom = Tokens.sp4), size = ButtonSize.Sm)
    }
}

// The user's latest decision on a phase or on the code, with Approve and a menu that asks for changes.
@Composable
internal fun DecisionRow(decision: BuildReview?, now: Long, readOnly: Boolean, approve: () -> Unit, askChanges: () -> Unit) {
    val meta = decision?.let { listOf(agoShort(it.at, now, " ago"), it.note).filter(String::isNotEmpty).joinToString(" · ") }
    ListRow(
        decisionTitle(decision), meta, metaLines = 2,
        trailing = if (readOnly) null else ({ Button("Approve", approve, variant = ButtonVariant.Filled, size = ButtonSize.Sm) }),
        menu = if (readOnly) null else ({ dismiss -> MenuItem("Request changes", "comment", { dismiss(); askChanges() }) }),
    )
}

// The phase strip, the shown phase rendered expanded and the user's latest decision on it. Approve moves the strip to the next phase.
internal fun LazyListScope.phaseItems(d: BuildDetail, picked: String?, now: Long, canOpen: Boolean, openFile: () -> Unit, readOnly: Boolean, run: TaskRun?, pick: (String) -> Unit, askChanges: (String) -> Unit, approve: (String, (Boolean) -> Unit) -> Unit) {
    if (d.phases.isEmpty()) return
    val phase = d.phases.firstOrNull { it.key == (picked ?: startPhase(d.phases, d.reviews)) } ?: d.phases.first()
    val decision = reviewDecision(d.reviews, phase.key)
    val tasks = if (phase.key == "tasks") specTasks(phase.markdown) else emptyList()
    val open = tasks.filter { !it.done }
    val runnable = run.takeIf { it != null && open.isNotEmpty() }
    item {
        SectionHeader("Spec", action = {
            if (tasks.isNotEmpty()) Badge(specProgress(tasks), BadgeTone.Quiet)
            if (runnable != null && !readOnly) MoreButton { dismiss -> MenuItem("Run all", "debug-start", { dismiss(); runnable.send(runAllPrompt(runnable.path)) }) }
            if (canOpen) IconBtn("go-to-file", "Open spec file", openFile)
        })
    }
    item {
        Row(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            d.phases.forEach { p -> Chip(phaseLabel(p.key), { pick(p.key) }, on = p.key == phase.key, icon = "check".takeIf { phaseApproved(d.reviews, p.key) }) }
        }
    }
    item {
        Group {
            Column(Modifier.padding(Tokens.listPad)) { Markdown(if (runnable != null) withoutOpenTasks(phase.markdown) else phase.markdown) }
            if (runnable != null) open.forEach { t ->
                Hairline()
                ListRow(t.text, trailing = if (t.doing) ({ Badge("In progress", BadgeTone.Running) }) else ({ Button("Start", { runnable.send(startTaskPrompt(t, runnable.path)) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !readOnly) }))
            }
            Hairline()
            DecisionRow(decision, now, readOnly, { approve(phase.key) { ok -> if (ok) pick(nextPhase(d.phases, phase.key)) } }, { askChanges(phase.key) })
        }
    }
}

@Composable
internal fun ChangesSheet(phase: String, send: (String, (Boolean) -> Unit) -> Unit, onDismiss: () -> Unit) {
    var note by remember { mutableStateOf("") }
    var failed by remember { mutableStateOf(false) }
    Sheet(onDismiss, "Request changes · ${phaseLabel(phase)}") {
        TextField(note, { note = it; failed = false }, placeholder = "What should change?", minLines = 4)
        if (failed) Text("Could not save the review. Your note is still here.", Modifier.padding(top = Tokens.sp4), style = Type.meta, color = av.err)
        Button("Send", { send(note.trim()) { ok -> if (ok) onDismiss() else failed = true } }, Modifier.padding(top = Tokens.sp6, bottom = Tokens.sp4), variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = note.isNotBlank())
    }
}

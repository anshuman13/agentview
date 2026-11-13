package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.codex.autopilot.openChatOf
import no.pradhan.agentview.nativeapp.net.ApiError
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.track
import no.pradhan.agentview.nativeapp.ops.DiffFiles
import no.pradhan.agentview.nativeapp.sessions.BuildCommit
import no.pradhan.agentview.nativeapp.sessions.BuildDetail
import no.pradhan.agentview.nativeapp.sessions.BuildEntry
import no.pradhan.agentview.nativeapp.sessions.BuildReview
import no.pradhan.agentview.nativeapp.sessions.CommitDiff
import no.pradhan.agentview.nativeapp.sessions.FLOW_LABEL
import no.pradhan.agentview.nativeapp.sessions.SpecCriterion
import no.pradhan.agentview.nativeapp.sessions.StageRow
import no.pradhan.agentview.nativeapp.sessions.byStart
import no.pradhan.agentview.nativeapp.sessions.criterionBadge
import no.pradhan.agentview.nativeapp.sessions.decisionTitle
import no.pradhan.agentview.nativeapp.sessions.nextPhase
import no.pradhan.agentview.nativeapp.sessions.parseBuild
import no.pradhan.agentview.nativeapp.sessions.phaseApproved
import no.pradhan.agentview.nativeapp.sessions.phaseLabel
import no.pradhan.agentview.nativeapp.sessions.reviewDecision
import no.pradhan.agentview.nativeapp.sessions.stageBadge
import no.pradhan.agentview.nativeapp.sessions.stageMeta
import no.pradhan.agentview.nativeapp.sessions.stageTitle
import no.pradhan.agentview.nativeapp.sessions.startPhase
import no.pradhan.agentview.nativeapp.sessions.stateBadge
import no.pradhan.agentview.nativeapp.sessions.withoutCriteria
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.DarkColors
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
import no.pradhan.agentview.nativeapp.workspace.FileScreen
import no.pradhan.agentview.nativeapp.workspace.SketchFrame
import no.pradhan.agentview.nativeapp.workspace.sketchPage
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
                    ListRow(stageTitle(e), stageMeta(e).ifEmpty { agoShort(e.startedAt, now, " ago") }, trailing = { Badge(label, tone) }, onClick = { showReport(Report(stageTitle(e), e.report, e.chat.ifEmpty { null }, e.session.orEmpty())) })
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
            if (phase.key == "sketch") SketchPhase(phase.markdown)
            else Column(Modifier.padding(Tokens.listPad)) { Markdown(if (runnable != null) withoutOpenTasks(phase.markdown) else phase.markdown) }
            if (runnable != null) open.forEach { t ->
                Hairline()
                ListRow(t.text, trailing = if (t.doing) ({ Badge("In progress", BadgeTone.Running) }) else ({ Button("Start", { runnable.send(startTaskPrompt(t, runnable.path)) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !readOnly) }))
            }
            Hairline()
            DecisionRow(decision, now, readOnly, { approve(phase.key) { ok -> if (ok) pick(nextPhase(d.phases, phase.key)) } }, { askChanges(phase.key) })
        }
    }
}

// The build's sketch in a phone or desktop frame, in the app's theme; the HTML comes with the build.
@Composable
private fun SketchPhase(html: String) {
    var desktop by remember { mutableStateOf(false) }
    val dark = av == DarkColors
    Row(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        Chip("Phone", { desktop = false }, on = !desktop)
        Chip("Desktop", { desktop = true }, on = desktop)
    }
    val page = remember(html, dark, desktop) { sketchPage(html, if (dark) "dark" else "light", desktop) }
    SketchFrame(page, desktop, Modifier.fillMaxWidth().height(SKETCH_HEIGHT))
}

private val SKETCH_HEIGHT = 480.dp

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

internal sealed interface BuildSheet {
    data class Spec(val initial: String? = null) : BuildSheet
    data class Step(val key: String) : BuildSheet
    data class Criterion(val n: Int) : BuildSheet
    data class File(val path: String) : BuildSheet
}

internal class BuildActions(val approve: (String, (Boolean) -> Unit) -> Unit, val saveReview: (String, String, String, (Boolean) -> Unit) -> Unit, val setHold: (String) -> Unit)

// The review and hold posts of one build; each reloads the build once it is saved.
@Composable
internal fun buildActions(hub: Hub, slug: String, reload: () -> Unit): BuildActions {
    val scope = rememberCoroutineScope()
    val postReview: (String, (Boolean) -> Unit) -> Unit = { body, done ->
        if (!hub.writes.allowed()) done(false)
        else scope.launch {
            val ok = runCatching { hub.api.post("/api/builds/review", body, hub.pageChat) }.isSuccess
            if (ok) reload()
            done(ok)
        }
    }
    val saveReview: (String, String, String, (Boolean) -> Unit) -> Unit = { key, decision, note, done ->
        postReview(buildJsonObject { put("slug", slug); put("phase", key); put("decision", decision); put("note", note) }.toString(), done)
    }
    val approve: (String, (Boolean) -> Unit) -> Unit = { key, done -> hub.track("action:approveSpec"); saveReview(key, "approve", "") { ok -> if (!ok) hub.notice.value = "Could not save the review. Try again."; done(ok) } }
    val setHold: (String) -> Unit = { decision -> postReview(buildJsonObject { put("slug", slug); put("decision", decision) }.toString()) { ok -> if (!ok) hub.notice.value = "Could not save the hold. Try again." } }
    return BuildActions(approve, saveReview, setHold)
}

// The build, or null when the server has no such spec any more.
internal suspend fun loadBuild(hub: Hub, slug: String): BuildDetail? =
    try { parseBuild(hub.read("/api/builds/one?slug=${enc(slug)}")) } catch (e: ApiError) { if (e.code == 404) null else throw e }

@Composable
private fun sheetHeight() = LocalConfiguration.current.screenHeightDp.dp * 0.8f

@Composable
private fun SheetList(content: LazyListScope.() -> Unit) {
    LazyColumn(Modifier.heightIn(max = sheetHeight()), content = content)
}

// The spec's acceptance criteria folded to `limit` rows, each opening its sheet.
@Composable
internal fun Criteria(criteria: List<SpecCriterion>, limit: Int, showAll: () -> Unit, open: (Int) -> Unit) {
    if (criteria.isEmpty()) return
    SectionHeader("Acceptance criteria", action = {
        val passed = criteria.count { it.result == "pass" }
        val failed = criteria.count { it.result == "fail" }
        if (passed > 0) Badge("$passed passed", BadgeTone.Done)
        if (failed > 0) Badge("$failed failed", BadgeTone.Failed)
    })
    if (limit > 0) Group {
        criteria.take(limit).forEachIndexed { i, c ->
            if (i > 0) Hairline()
            val badge = criterionBadge(c)
            ListRow(c.text, "${if (c.ui) "UI · " else ""}${c.evidence.ifEmpty { "Not tested" }}", state = { if (badge != null) Badge(badge.first, badge.second) }, stateSlot = true, onClick = { open(c.n) })
        }
    }
    if (limit < criteria.size) Button("Show all ${criteria.size}", showAll, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
}

// The open sheets of a build card, the topmost composed last.
@Composable
internal fun BuildSheets(hub: Hub, d: BuildDetail, stack: SnapshotStateList<BuildSheet>, actions: BuildActions, run: TaskRun?) {
    val close: () -> Unit = { stack.removeAt(stack.lastIndex) }
    stack.forEachIndexed { i, s ->
        key(i) {
            when (s) {
                is BuildSheet.Spec -> SpecSheet(hub, d, s.initial, actions, run, close)
                is BuildSheet.Step -> StepSheet(hub, d, s.key, actions, stack, close)
                is BuildSheet.Criterion -> d.criteria.firstOrNull { it.n == s.n }?.let { CriterionSheet(it, close) }
                is BuildSheet.File -> Sheet(close, "File", padded = false) { Box(Modifier.height(sheetHeight())) { FileScreen(hub, s.path, close) } }
            }
        }
    }
}

@Composable
private fun SpecSheet(hub: Hub, d: BuildDetail, initial: String?, actions: BuildActions, run: TaskRun?, close: () -> Unit) {
    var phase by remember { mutableStateOf(initial) }
    var asking by remember { mutableStateOf<String?>(null) }
    val spec = remember(d) { d.copy(phases = d.phases.map { if (it.key == "sketch") it else it.copy(markdown = withoutCriteria(it.markdown)) }) }
    Sheet(close, "Spec", padded = false) {
        if (spec.phases.isEmpty()) EmptyState("No spec phases yet")
        else SheetList { phaseItems(spec, phase, System.currentTimeMillis(), false, {}, hub.readOnly, run, { phase = it }, { asking = it }, actions.approve) }
    }
    asking?.let { key -> ChangesSheet(key, { note, done -> actions.saveReview(key, "changes", note, done) }) { asking = null } }
}

private val STEP_STAGE = mapOf("spec-review" to "review", "implement" to "implement", "test" to "test", "code-review" to "code-review")

@Composable
private fun StepSheet(hub: Hub, d: BuildDetail, step: String, actions: BuildActions, stack: SnapshotStateList<BuildSheet>, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    var report by remember { mutableStateOf<Report?>(null) }
    var asking by remember { mutableStateOf(false) }
    var openFile by remember { mutableStateOf<String?>(null) }
    val stages = byStart(d.entries)
    val runs = stages.filter { it.stage == STEP_STAGE[step] }.reversed()
    val review = stages.lastOrNull { it.stage == "code-review" }
    val commit = d.commit?.let { c -> stages.lastOrNull { it.stage == "implement" }?.commit?.let { it to c } }
    val now = System.currentTimeMillis()
    Sheet(close, FLOW_LABEL.getValue(step), padded = false) {
        SheetList {
            if (runs.isEmpty()) item { EmptyState("No runs yet") } else stageItems(runs.map { StageRow(it.startedAt, entry = it) }, now) { report = it }
            when (step) {
                "implement" -> if (commit != null) implementationItems(commit.first, commit.second, openFile) { openFile = it }
                "code-review" -> if (review != null || commit != null) codeReviewItems(d, review, commit != null, now, hub.readOnly, { actions.approve("code") { } }, { asking = true })
                "test" -> item { Criteria(d.criteria, d.criteria.size, {}) { stack.add(BuildSheet.Criterion(it)) } }
            }
        }
    }
    report?.let { ReportSheet(hub, scope, it) { report = null } }
    if (asking) ChangesSheet("code", { note, done -> actions.saveReview("code", "changes", note, done) }) { asking = false }
}

@Composable
private fun CriterionSheet(c: SpecCriterion, close: () -> Unit) {
    val pad = Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4)
    Sheet(close, "Criterion ${c.n}", padded = false) {
        SheetList {
            item { Markdown(c.text, pad) }
            if (c.ui) item { Group { ListRow("UI check") } }
            item { Markdown(c.evidence.ifEmpty { "Not tested yet" }, pad) }
        }
    }
}

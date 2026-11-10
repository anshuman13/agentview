package no.pradhan.agentview.nativeapp.sessions

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.codex.autopilot.openChatOf
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.ops.DiffFiles
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
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.FileScreen
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.PrFile
import no.pradhan.agentview.nativeapp.workspace.WorkspaceHeader
import no.pradhan.agentview.nativeapp.workspace.agoShort
import no.pradhan.agentview.nativeapp.workspace.pageFolder
import no.pradhan.agentview.nativeapp.workspace.rememberLoad
import no.pradhan.agentview.nativeapp.workspace.runAllPrompt
import no.pradhan.agentview.nativeapp.workspace.startTaskPrompt
import no.pradhan.agentview.nativeapp.workspace.specProgress
import no.pradhan.agentview.nativeapp.workspace.specTasks
import no.pradhan.agentview.nativeapp.workspace.withoutOpenTasks

private const val BUILDS_POLL_MS = 15_000L

// Reloads every 15 s while `running`.
@Composable
private fun PollWhile(running: Boolean, reload: () -> Unit) {
    LaunchedEffect(running) { while (running) { delay(BUILDS_POLL_MS); reload() } }
}

@Composable
private fun LoadFailed(what: String, reload: () -> Unit) {
    EmptyState("Could not load $what", "Try again", action = { Button("Retry", reload, size = ButtonSize.Sm) })
}

// Builds (web/src/sessions/Builds.tsx): the specs the build agents work on, and a detail page for one.
@Composable
fun BuildsScreen(hub: Hub, onBack: () -> Unit) {
    val chat = hub.store.state.collectAsState().value.shownId
    val (load, reload) = rememberLoad(chat) { parseBuilds(hub.read("/api/builds")) }
    var open by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    val list = rememberLazyListState()
    var expanded by remember(chat) { mutableStateOf(emptySet<String>()) }
    val slug by hub.buildSlug.collectAsState()
    LaunchedEffect(slug) { slug?.let { open = it; hub.buildSlug.value = null } }
    PollWhile(open == null && load.data?.any { it.state == "running" } == true, reload)
    open?.let { BuildDetailScreen(hub, it, onBack = { open = null }); return }
    val now = System.currentTimeMillis()
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Builds", onBack, sub = "Specs and what the agents did with them in ${pageFolder(hub)}")
        PageBody {
            val builds = load.data
            when {
                builds == null && load.error.isNotEmpty() -> LoadFailed("builds", reload)
                builds == null -> Loading("Loading builds")
                builds.isEmpty() -> EmptyState("No builds yet", "Specs in .claude/specs show here", icon = "beaker")
                else -> LazyColumn(Modifier.fillMaxSize(), state = list) {
                    buildGroups(builds).forEach { g ->
                        val rows = if (g.key == "active" || g.key in expanded) g.rows else g.rows.take(BUILD_FOLD)
                        item(key = "h-${g.key}") { SectionHeader(g.label, g.rows.size.toString()) }
                        item(key = "g-${g.key}") {
                            Group {
                                rows.forEachIndexed { i, b ->
                                    if (i > 0) Hairline(lead = true)
                                    ListRow(b.title, "${pipelineLabel(b.pipeline)} · ${b.conclusion} · ${agoShort(b.updatedAt, now, " ago")}", leading = if (b.draft) null else ({ StatusDot(stateDot(b.state)) }), trailing = if (b.hold) ({ Badge(HOLD_BADGE.first, HOLD_BADGE.second) }) else null, onClick = { open = b.slug })
                                }
                            }
                        }
                        if (rows.size < g.rows.size) item(key = "m-${g.key}") { Button("Show all ${g.rows.size}", { expanded = expanded + g.key }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm) }
                    }
                    item { Spacer(Modifier.padding(bottom = Tokens.sp8)) }
                }
            }
        }
    }
}

// One build (web BuildDetail): the conclusion, the spec, the stages, the commit, the tests and the code review.
@Composable
private fun BuildDetailScreen(hub: Hub, slug: String, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val chat = hub.store.state.collectAsState().value.shownId
    val (load, reload) = rememberLoad(chat, slug) { parseBuild(hub.read("/api/builds/one?slug=${enc(slug)}")) }
    val ws by hub.workspace.collectAsState()
    val cwd = hub.store.state.collectAsState().value.session?.cwd.orEmpty()
    val scope = rememberCoroutineScope()
    var specFile by rememberSaveable(slug) { mutableStateOf(false) }
    var report by remember { mutableStateOf<Report?>(null) }
    var phase by rememberSaveable(slug) { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf<String?>(null) }
    var openFile by rememberSaveable(slug) { mutableStateOf<String?>(null) }
    val d = load.data
    PollWhile(d?.summary?.state == "running", reload)
    d?.specFile?.let { if (specFile) { FileScreen(hub, it, onBack = { specFile = false }); return } }
    val postReview = { body: String, done: (Boolean) -> Unit ->
        if (!hub.writes.allowed()) done(false)
        else scope.launch {
            val ok = runCatching { hub.api.post("/api/builds/review", body, hub.pageChat) }.isSuccess
            if (ok) reload()
            done(ok)
        }
    }
    val saveReview = { key: String, decision: String, note: String, done: (Boolean) -> Unit ->
        postReview(buildJsonObject { put("slug", slug); put("phase", key); put("decision", decision); put("note", note) }.toString(), done)
    }
    val approve: (String, (Boolean) -> Unit) -> Unit = { key, done -> saveReview(key, "approve", "") { ok -> if (!ok) hub.notice.value = "Could not save the review. Try again."; done(ok) } }
    val setHold = { decision: String -> postReview(buildJsonObject { put("slug", slug); put("decision", decision) }.toString()) { ok -> if (!ok) hub.notice.value = "Could not save the hold. Try again." } }
    val inMain = ws.repos.any { inside(cwd, it.cwd) } && ws.trees.none { inside(cwd, it.cwd) }
    val now = System.currentTimeMillis()
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, d?.title ?: slug, onBack, actions = {
            if (d != null && !hub.readOnly) MoreButton { dismiss -> MenuItem(if (d.hold) "Release hold" else "Hold", "debug-pause", { dismiss(); setHold(if (d.hold) "release" else "hold") }) }
        })
        PageBody {
            when {
                d == null && load.error.isNotEmpty() -> LoadFailed("this build", reload)
                d == null -> Loading("Loading build")
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    val stages = byStart(d.entries)
                    val rows = stageRows(d.entries, d.reviews)
                    val commit = d.commit?.let { c -> stages.lastOrNull { it.stage == "implement" }?.commit?.let { it to c } }
                    val test = stages.lastOrNull { it.stage == "test" }
                    val review = stages.lastOrNull { it.stage == "code-review" }
                    item { SectionHeader("Conclusion") }
                    item {
                        Group {
                            val (label, tone) = stateBadge(d.summary.state)
                            ListRow(d.summary.conclusion, "${stageName(d.summary.stage)} · ${agoShort(d.updatedAt, now, " ago")}", trailing = if (d.hold) ({ Badge(HOLD_BADGE.first, HOLD_BADGE.second) }) else if (d.entries.isEmpty()) null else ({ Badge(label, tone) }))
                        }
                    }
                    val run = d.specFile?.takeIf { chat.isNotEmpty() }?.let { "$cwd/$it" }?.let { path -> TaskRun(path) { hub.askChat(it) } }
                    phaseItems(d, phase, now, inMain && d.specFile != null, { specFile = true }, hub.readOnly, run, { phase = it }, { asking = it }, approve)
                    item { SectionHeader("Stages", rows.size.toString()) }
                    item {
                        Group {
                            rows.forEachIndexed { i, r ->
                                if (i > 0) Hairline()
                                val e = r.entry
                                val y = r.review
                                if (e != null) {
                                    val (label, tone) = stageBadge(e)
                                    ListRow(stageTitle(e), stageMeta(e).ifEmpty { agoShort(e.startedAt, now, " ago") }, trailing = { Badge(label, tone) }, onClick = { report = Report(stageTitle(e), e.report, e.chat, e.session.orEmpty()) })
                                } else if (y != null) {
                                    val (label, tone) = stateBadge(if (y.decision == "approve") "done" else "waiting")
                                    ListRow("You · ${phaseLabel(y.phase)}", y.note.ifEmpty { agoShort(y.at, now, " ago") }, metaLines = 2, trailing = { Badge(label, tone) }, onClick = { report = Report("You · ${phaseLabel(y.phase)}", y.note.ifEmpty { decisionTitle(y) }) })
                                }
                            }
                        }
                    }
                    if (commit != null) {
                        val (c, diff) = commit
                        val files = diff.files.map { PrFile(it.path, it.add, it.del) }
                        item { SectionHeader("Implementation") }
                        item {
                            Group {
                                ListRow(c.branch ?: c.subject, "${c.sha.take(7)} · ${files.size} ${if (files.size == 1) "file" else "files"} +${files.sumOf { it.additions }} -${files.sumOf { it.deletions }}")
                                if (files.isNotEmpty()) Hairline()
                                DiffFiles(files, diff.diff, openFile) { openFile = it }
                            }
                        }
                    }
                    if (test != null) {
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
                    if (review != null || commit != null) {
                        item { SectionHeader("Code review") }
                        item {
                            Group {
                                if (review != null && review.findings.isEmpty()) ListRow("Clean")
                                review?.findings?.forEachIndexed { i, f ->
                                    if (i > 0) Hairline()
                                    ListRow(f, lines = 2)
                                }
                                if (commit != null) {
                                    if (review != null) Hairline()
                                    DecisionRow(d.codeReview, now, hub.readOnly, { approve("code") { } }, { asking = "code" })
                                }
                            }
                        }
                    }
                    item { Spacer(Modifier.padding(bottom = Tokens.sp8)) }
                }
            }
        }
    }
    report?.let { r ->
        Sheet({ report = null }, r.title) {
            if (r.text.isBlank()) EmptyState("No report yet") else Markdown(r.text, Modifier.padding(bottom = Tokens.sp6))
            if (r.chat != null) Button("Open chat", { scope.launch { if (hub.openChatOf(r.chat, r.session)) { hub.link.value = DeepLink(view = "agents"); report = null } } }, Modifier.padding(bottom = Tokens.sp4), size = ButtonSize.Sm)
        }
    }
    asking?.let { key -> ChangesSheet(key, { note, done -> saveReview(key, "changes", note, done) }) { asking = null } }
}

private class Report(val title: String, val text: String, val chat: String? = null, val session: String = "")

private class TaskRun(val path: String, val send: (String) -> Unit)

// The user's latest decision on a phase or on the code, with Approve and a menu that asks for changes.
@Composable
private fun DecisionRow(decision: BuildReview?, now: Long, readOnly: Boolean, approve: () -> Unit, askChanges: () -> Unit) {
    val meta = decision?.let { listOf(agoShort(it.at, now, " ago"), it.note).filter(String::isNotEmpty).joinToString(" · ") }
    ListRow(
        decisionTitle(decision), meta, metaLines = 2,
        trailing = if (readOnly) null else ({ Button("Approve", approve, variant = ButtonVariant.Filled, size = ButtonSize.Sm) }),
        menu = if (readOnly) null else ({ dismiss -> MenuItem("Request changes", "comment", { dismiss(); askChanges() }) }),
    )
}

// The phase strip, the shown phase rendered expanded and the user's latest decision on it. Approve moves the strip to the next phase.
private fun LazyListScope.phaseItems(d: BuildDetail, picked: String?, now: Long, canOpen: Boolean, openFile: () -> Unit, readOnly: Boolean, run: TaskRun?, pick: (String) -> Unit, askChanges: (String) -> Unit, approve: (String, (Boolean) -> Unit) -> Unit) {
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
private fun ChangesSheet(phase: String, send: (String, (Boolean) -> Unit) -> Unit, onDismiss: () -> Unit) {
    var note by remember { mutableStateOf("") }
    var failed by remember { mutableStateOf(false) }
    Sheet(onDismiss, "Request changes · ${phaseLabel(phase)}") {
        TextField(note, { note = it; failed = false }, placeholder = "What should change?", minLines = 4)
        if (failed) Text("Could not save the review. Your note is still here.", Modifier.padding(top = Tokens.sp4), style = Type.meta, color = av.err)
        Button("Send", { send(note.trim()) { ok -> if (ok) onDismiss() else failed = true } }, Modifier.padding(top = Tokens.sp6, bottom = Tokens.sp4), variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = note.isNotBlank())
    }
}

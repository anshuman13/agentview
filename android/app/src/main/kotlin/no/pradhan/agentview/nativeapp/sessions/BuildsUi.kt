package no.pradhan.agentview.nativeapp.sessions

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.workspace.FileScreen
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.PrFile
import no.pradhan.agentview.nativeapp.workspace.WorkspaceHeader
import no.pradhan.agentview.nativeapp.workspace.agoShort
import no.pradhan.agentview.nativeapp.workspace.pageFolder
import no.pradhan.agentview.nativeapp.workspace.rememberLoad

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
                builds.isEmpty() -> EmptyState("No builds yet", "Specs the build agents work on show here", icon = "beaker")
                else -> LazyColumn(Modifier.fillMaxSize(), state = list) {
                    item { SectionHeader("Builds", builds.size.toString()) }
                    item {
                        Group {
                            builds.forEachIndexed { i, b ->
                                if (i > 0) Hairline(lead = true)
                                ListRow(b.title, "${stageName(b.stage)} · ${b.conclusion} · ${agoShort(b.updatedAt, now, " ago")}", leading = { StatusDot(stateDot(b.state)) }, onClick = { open = b.slug })
                            }
                        }
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
    var spec by rememberSaveable(slug) { mutableStateOf(false) }
    var specFile by rememberSaveable(slug) { mutableStateOf(false) }
    var report by remember { mutableStateOf<BuildEntry?>(null) }
    var openFile by rememberSaveable(slug) { mutableStateOf<String?>(null) }
    val d = load.data
    PollWhile(d?.summary?.state == "running", reload)
    if (specFile) { FileScreen(hub, ".claude/specs/$slug.md", onBack = { specFile = false }); return }
    val inMain = ws.repos.any { inside(cwd, it.cwd) } && ws.trees.none { inside(cwd, it.cwd) }
    val now = System.currentTimeMillis()
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, d?.title ?: slug, onBack)
        PageBody {
            when {
                d == null && load.error.isNotEmpty() -> LoadFailed("this build", reload)
                d == null -> Loading("Loading build")
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    val stages = byStart(d.entries)
                    val commit = d.commit?.let { c -> stages.lastOrNull { it.stage == "implement" }?.commit?.let { it to c } }
                    val test = stages.lastOrNull { it.stage == "test" }
                    val review = stages.lastOrNull { it.stage == "code-review" }
                    item { SectionHeader("Conclusion") }
                    item {
                        Group {
                            val (label, tone) = stateBadge(d.summary.state)
                            ListRow(d.summary.conclusion, "${stageName(d.summary.stage)} · ${agoShort(updatedAt(d.entries), now, " ago")}", trailing = { Badge(label, tone) })
                        }
                    }
                    if (d.spec != null) {
                        item { SectionHeader("Spec", open = spec, onToggle = { spec = !spec }, action = { if (inMain) IconBtn("go-to-file", "Open spec file", { specFile = true }) }) }
                        if (spec) item { Group { Column(Modifier.padding(Tokens.listPad)) { Markdown(d.spec) } } }
                    }
                    item { SectionHeader("Stages", stages.size.toString()) }
                    item {
                        Group {
                            stages.forEachIndexed { i, e ->
                                if (i > 0) Hairline()
                                val (label, tone) = stageBadge(e)
                                ListRow(stageTitle(e), stageMeta(e).ifEmpty { agoShort(e.startedAt, now, " ago") }, trailing = { Badge(label, tone) }, onClick = { report = e })
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
                    if (review != null) {
                        item { SectionHeader("Code review") }
                        item {
                            Group {
                                if (review.findings.isEmpty()) ListRow("Clean")
                                review.findings.forEachIndexed { i, f ->
                                    if (i > 0) Hairline()
                                    ListRow(f, lines = 2)
                                }
                            }
                        }
                    }
                    item { Spacer(Modifier.padding(bottom = Tokens.sp8)) }
                }
            }
        }
    }
    report?.let { e ->
        Sheet({ report = null }, stageTitle(e)) {
            if (e.report.isBlank()) EmptyState("No report yet") else Markdown(e.report, Modifier.padding(bottom = Tokens.sp6))
            Button("Open chat", { scope.launch { if (hub.openChatOf(e.chat, e.session.orEmpty())) { hub.link.value = DeepLink(view = "agents"); report = null } } }, Modifier.padding(bottom = Tokens.sp4), size = ButtonSize.Sm)
        }
    }
}

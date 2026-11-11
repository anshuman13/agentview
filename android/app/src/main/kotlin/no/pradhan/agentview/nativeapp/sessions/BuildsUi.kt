package no.pradhan.agentview.nativeapp.sessions

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.chat.ChangesSheet
import no.pradhan.agentview.nativeapp.chat.LoadFailed
import no.pradhan.agentview.nativeapp.chat.PollWhile
import no.pradhan.agentview.nativeapp.chat.Report
import no.pradhan.agentview.nativeapp.chat.ReportSheet
import no.pradhan.agentview.nativeapp.chat.TaskRun
import no.pradhan.agentview.nativeapp.chat.codeReviewItems
import no.pradhan.agentview.nativeapp.chat.implementationItems
import no.pradhan.agentview.nativeapp.chat.phaseItems
import no.pradhan.agentview.nativeapp.chat.stageItems
import no.pradhan.agentview.nativeapp.chat.testItems
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.track
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.workspace.FileScreen
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.WorkspaceHeader
import no.pradhan.agentview.nativeapp.workspace.agoShort
import no.pradhan.agentview.nativeapp.workspace.rememberLoad

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
        WorkspaceHeader(hub, "Builds", onBack)
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
    val approve: (String, (Boolean) -> Unit) -> Unit = { key, done -> hub.track("action:approveSpec"); saveReview(key, "approve", "") { ok -> if (!ok) hub.notice.value = "Could not save the review. Try again."; done(ok) } }
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
                    val commit = d.commit?.let { c -> stages.lastOrNull { it.stage == "implement" }?.commit?.let { it to c } }
                    val review = stages.lastOrNull { it.stage == "code-review" }
                    conclusionItems(d, now)
                    val run = d.specFile?.takeIf { chat.isNotEmpty() }?.let { "$cwd/$it" }?.let { path -> TaskRun(path) { hub.askChat(it) } }
                    phaseItems(d, phase, now, inMain && d.specFile != null, { specFile = true }, hub.readOnly, run, { phase = it }, { asking = it }, approve)
                    stageItems(stageRows(d.entries, d.reviews), now) { report = it }
                    if (commit != null) implementationItems(commit.first, commit.second, openFile) { openFile = it }
                    stages.lastOrNull { it.stage == "test" }?.let { testItems(it) }
                    if (review != null || commit != null) codeReviewItems(d, review, commit != null, now, hub.readOnly, { approve("code") { } }, { asking = "code" })
                    item { Spacer(Modifier.padding(bottom = Tokens.sp8)) }
                }
            }
        }
    }
    report?.let { ReportSheet(hub, scope, it) { report = null } }
    asking?.let { key -> ChangesSheet(key, { note, done -> saveReview(key, "changes", note, done) }) { asking = null } }
}

private fun LazyListScope.conclusionItems(d: BuildDetail, now: Long) {
    item { SectionHeader("Conclusion") }
    item {
        Group {
            val (label, tone) = stateBadge(d.summary.state)
            ListRow(d.summary.conclusion, "${stageName(d.summary.stage)} · ${agoShort(d.updatedAt, now, " ago")}", trailing = if (d.hold) ({ Badge(HOLD_BADGE.first, HOLD_BADGE.second) }) else if (d.entries.isEmpty()) null else ({ Badge(label, tone) }))
        }
    }
}

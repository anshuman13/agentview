package no.pradhan.agentview.nativeapp.ops

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.chat.firstLine
import no.pradhan.agentview.nativeapp.codex.firstLine
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.net.actOnPull
import no.pradhan.agentview.nativeapp.net.pullDetail
import no.pradhan.agentview.nativeapp.net.pulls
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tag
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.Counts
import no.pradhan.agentview.nativeapp.workspace.DiffCodeLine
import no.pradhan.agentview.nativeapp.workspace.ErrorHint
import no.pradhan.agentview.nativeapp.workspace.FileTag
import no.pradhan.agentview.nativeapp.workspace.Hint
import no.pradhan.agentview.nativeapp.workspace.Loaded
import no.pradhan.agentview.nativeapp.workspace.MERGE_METHODS
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.PrFile
import no.pradhan.agentview.nativeapp.workspace.PullRequest
import no.pradhan.agentview.nativeapp.workspace.PullRequestDetail
import no.pradhan.agentview.nativeapp.workspace.WorkspaceHeader
import no.pradhan.agentview.nativeapp.workspace.agoShort
import no.pradhan.agentview.nativeapp.workspace.autoMergeBody
import no.pradhan.agentview.nativeapp.workspace.autoMergeOn
import no.pradhan.agentview.nativeapp.workspace.autoMergeMeta
import no.pradhan.agentview.nativeapp.workspace.checkDot
import no.pradhan.agentview.nativeapp.workspace.fixPrPrompt
import no.pradhan.agentview.nativeapp.workspace.ghProblem
import no.pradhan.agentview.nativeapp.workspace.isoMillis
import no.pradhan.agentview.nativeapp.workspace.langOf
import no.pradhan.agentview.nativeapp.workspace.mergeBody
import no.pradhan.agentview.nativeapp.workspace.openLink
import no.pradhan.agentview.nativeapp.workspace.parentOf
import no.pradhan.agentview.nativeapp.workspace.patchLines
import no.pradhan.agentview.nativeapp.workspace.prGroups
import no.pradhan.agentview.nativeapp.workspace.rememberLoad
import no.pradhan.agentview.nativeapp.workspace.reviewBody
import no.pradhan.agentview.nativeapp.workspace.reviewLabel
import no.pradhan.agentview.nativeapp.workspace.splitDiff
import no.pradhan.agentview.nativeapp.ui.select
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Pull Requests (web/src/ops/GitHub.tsx): the repo's open PRs in three groups, and a PR page with review actions.
@Composable
fun PullsScreen(hub: Hub, onBack: () -> Unit, initial: Int? = null) {
    val shownId by hub.store.state.select { it.shownId }
    val chat = shownId
    var fresh by remember { mutableStateOf(false) }
    val (load, reload) = rememberLoad(chat) {
        val was = fresh
        fresh = false
        hub.pulls(was)
    }
    var open by rememberSaveable(chat) { mutableStateOf(initial) }
    val pr = load.data?.firstOrNull { it.number == open }
    if (pr != null) { PullScreen(hub, pr, onBack = { if (initial != null) onBack() else open = null }, onChanged = { fresh = true; reload() }); return }
    val now = System.currentTimeMillis()

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Pull Requests", onBack) { IconBtn("refresh", "Refresh", { fresh = true; reload() }, enabled = !load.busy) }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                val problem = ghProblem(load.error)
                when {
                    problem != null -> item { EmptyState(problem.title, problem.text + (problem.cmd?.let { "\n$it" } ?: ""), small = false) }
                    load.error.isNotEmpty() -> item { ErrorHint(load.error) }
                    load.data == null -> item { Hint("Loading…") }
                    load.data.isEmpty() -> item { EmptyState("No open pull requests", icon = "git-pull-request", small = false) }
                    else -> prGroups(load.data).filter { it.prs.isNotEmpty() }.forEach { g ->
                        item(key = g.title) {
                            var shown by rememberSaveable(g.title) { mutableStateOf(true) }
                            Column {
                                SectionHeader(g.title, g.prs.size.toString(), open = shown, onToggle = { shown = !shown })
                                if (shown) Group {
                                    g.prs.forEachIndexed { i, p ->
                                        if (i > 0) Hairline(lead = true)
                                        PrRow(p, now) { open = p.number }
                                    }
                                }
                            }
                        }
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}

@Composable
private fun PrState(pr: PullRequest) {
    if (pr.draft) Tag("Draft") else reviewLabel(pr.review)?.let { (label, tone) -> Tag(label, tone) }
}

@Composable
private fun PrRow(pr: PullRequest, now: Long, onClick: () -> Unit) {
    ListRow(
        pr.title, "#${pr.number} · ${pr.author} · ${pr.branch}${if (pr.autoMerge != null) " · Auto-merge" else ""} · ${agoShort(isoMillis(pr.updatedAt), now)}",
        leading = { StatusDot(checkDot(pr.checks)) },
        trailing = { PrState(pr) },
        onClick = onClick,
    )
}

private const val PR_DIFF_LINES = 400

private class PullUi {
    var busy by mutableStateOf("")
    var confirm by mutableStateOf<Pair<String, () -> Unit>?>(null)
    val idle get() = busy.isEmpty()
}

private class PullCtx(val hub: Hub, val pr: PullRequest, val ui: PullUi, private val reload: () -> Unit, private val onChanged: () -> Unit) {
    fun act(label: String, path: String, body: String, done: () -> Unit = {}) {
        ui.busy = label
        hub.actOnPull(pr.number, path, body, "Could not $label") { ok -> ui.busy = ""; if (ok) { done(); reload(); onChanged() } }
    }
}

@Composable
private fun PullScreen(hub: Hub, pr: PullRequest, onBack: () -> Unit, onChanged: () -> Unit) {
    BackHandler(onBack = onBack)
    val (load, reload) = rememberLoad(pr.number, pr.sha) { hub.pullDetail(pr.number) }
    val ui = remember { PullUi() }
    val c = PullCtx(hub, pr, ui, reload, onChanged)
    var text by rememberSaveable(pr.number) { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "#${pr.number}", onBack, sub = pr.branch) { PullMenu(c, load.data, onBack) }
        PageBody { PullBody(c, load) }
        HorizontalDivider(color = av.border, thickness = Tokens.hairline)
        PullReviewBar(c, text, { text = it })
    }
    ui.confirm?.let { (title, run) -> ConfirmDialog(title, pr.title, title.substringBefore(' '), run, danger = false, onDismiss = { ui.confirm = null }) }
}

@Composable
private fun PullMenu(c: PullCtx, d: PullRequestDetail?, onBack: () -> Unit) {
    val pr = c.pr
    val hub = c.hub
    val link = openLink()
    val label = providerLabel(hub.store.state.select { it.session?.provider }.value)
    MoreButton { close ->
        MenuItem("Ask $label to review", "sparkle", { close(); hub.askChat(reviewPrPrompt(pr.number)) })
        val fix = d?.let { fixPrPrompt(pr.number, it) }
        MenuItem("Fix in chat", "wrench", { close(); fix?.let(hub::draftPrompt); onBack() }, enabled = fix != null)
        MenuItem("Open on GitHub", "link-external", { close(); link(pr.url) })
        MenuSeparator()
        val on = pr.autoMergeOn
        // Web picks the method in the pane; here each method has its own item, as for Merge below.
        if (on) MenuItem("Merge when checks pass", "git-merge", { close(); c.act("automerge", "automerge", autoMergeBody(false, MERGE_METHODS.first().first)) }, enabled = c.ui.idle && !hub.readOnly, checked = true)
        else MERGE_METHODS.forEach { (m, label) ->
            MenuItem("Merge when checks pass: $label", "git-merge", {
                close()
                c.ui.confirm = "Merge #${pr.number} (${label.lowercase()}) when its checks pass?" to { c.act("automerge", "automerge", autoMergeBody(true, m)) }
            }, enabled = c.ui.idle && !hub.readOnly)
        }
        MERGE_METHODS.forEach { (m, label) ->
            MenuItem(if (m == "merge") "Merge with a merge commit" else "Merge: $label", "git-merge", { close(); c.ui.confirm = "Merge #${pr.number} (${label.lowercase()})?" to { c.act("merge", "merge", mergeBody(m)) } }, enabled = c.ui.idle)
        }
        MenuItem("Check out ${pr.branch}", "git-branch", { close(); c.act("checkout", "checkout", "{}") }, enabled = c.ui.idle)
    }
}

@Composable
private fun PullReviewBar(c: PullCtx, text: String, onText: (String) -> Unit) {
    val idle = c.ui.idle
    val clear = { onText("") }
    Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
        TextField(text, onText, Modifier.weight(1f), placeholder = "Leave a comment", maxLines = 4)
        Button("Approve", { c.ui.confirm = "Approve #${c.pr.number}?" to { c.act("approve", "review", reviewBody("approve", text), clear) } }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = idle)
        MoreButton { close ->
            MenuItem("Comment", "comment", { close(); c.act("comment", "review", reviewBody("comment", text), clear) }, enabled = idle && text.isNotBlank())
            MenuItem("Request changes", "request-changes", { close(); c.act("request_changes", "review", reviewBody("request_changes", text), clear) }, enabled = idle && text.isNotBlank())
        }
    }
}

@Composable
private fun PullBody(c: PullCtx, load: Loaded<PullRequestDetail>) {
    val pr = c.pr
    val d = load.data
    val now = System.currentTimeMillis()
    var openFile by rememberSaveable(pr.number) { mutableStateOf<String?>(null) }
    LazyColumn(Modifier.fillMaxSize()) {
        item { PullSummary(pr, now) }
        if (c.ui.busy.isNotEmpty()) item { Hint("Running ${c.ui.busy.replace('_', ' ')}...") }
        item { ErrorHint(load.error) }
        if (d == null) { if (load.error.isEmpty()) item { Hint("Loading…") } }
        else {
            item { Column { Findings(c.hub, pr.number.toString()) { openFile = it.file } } }
            item { SectionHeader("Description") }
            item { Group { if (d.body.isBlank()) EmptyState("No description") else Column(Modifier.padding(Tokens.listPad)) { Markdown(d.body) } } }
            pullChecks(d)
            pullReviews(d, now)
            pullCommits(d)
            pullFiles(d, openFile) { openFile = it }
        }
        item { Spacer(Modifier.padding(bottom = Tokens.sp8)) }
    }
}

@Composable
private fun PullSummary(pr: PullRequest, now: Long) {
    Group(Modifier.padding(top = Tokens.sp4)) {
        val meta = buildAnnotatedString {
            append("${pr.author} · ${pr.branch} · ${agoShort(isoMillis(pr.updatedAt), now)} · ")
            withStyle(SpanStyle(color = av.diffAdd)) { append("+${pr.additions}") }
            append(" ")
            withStyle(SpanStyle(color = av.diffDel)) { append("-${pr.deletions}") }
        }
        ListRow(pr.title, meta, lines = 3, leading = { StatusDot(checkDot(pr.checks)) }, trailing = { PrState(pr) })
        pr.autoMerge?.let { Hairline(lead = true); ListRow("Auto-merge", it.autoMergeMeta(), lines = 1) }
    }
}

private fun LazyListScope.pullChecks(d: PullRequestDetail) {
    if (d.checks.isEmpty()) return
    item { SectionHeader("Checks", d.checks.size.toString()) }
    item {
        val link = openLink()
        Group {
            d.checks.forEachIndexed { i, c ->
                if (i > 0) Hairline(lead = true)
                ListRow(c.name, lines = 1, leading = { StatusDot(checkDot(c.state)) }, onClick = if (c.url.isNotEmpty()) ({ link(c.url) }) else null)
            }
        }
    }
}

private fun LazyListScope.pullReviews(d: PullRequestDetail, now: Long) {
    if (d.reviews.isEmpty()) return
    item { SectionHeader("Reviews", d.reviews.size.toString()) }
    item {
        Group {
            d.reviews.forEachIndexed { i, r ->
                if (i > 0) Hairline()
                ListRow(r.author, agoShort(isoMillis(r.at), now), trailing = { reviewLabel(r.state)?.let { (l, t) -> Tag(l, t) } })
                if (r.body.isNotBlank()) Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp6)) { Markdown(r.body) }
            }
        }
    }
}

private fun LazyListScope.pullCommits(d: PullRequestDetail) {
    if (d.commits.isEmpty()) return
    item { SectionHeader("Commits", d.commits.size.toString()) }
    item {
        Group {
            d.commits.forEachIndexed { i, c ->
                if (i > 0) Hairline()
                ListRow(firstLine(c.message), shortSha(c.oid))
            }
        }
    }
}

private fun LazyListScope.pullFiles(d: PullRequestDetail, openFile: String?, onOpenFile: (String?) -> Unit) {
    if (d.files.isEmpty()) return
    item { SectionHeader("Files changed", d.files.size.toString()) }
    item { Group { DiffFiles(d.files, d.diff, openFile, onOpenFile) } }
}

// The changed files as rows; a tap shows that file's patch under its row.
@Composable
fun DiffFiles(files: List<PrFile>, diff: String, openFile: String?, onOpenFile: (String?) -> Unit) {
    // A diff can be megabytes; it is split off the main thread, and patches show once it is.
    val diffs by produceState<Map<String, String>?>(null, diff) { value = withContext(Dispatchers.Default) { splitDiff(diff) } }
    files.forEachIndexed { i, f ->
        if (i > 0) Hairline(lead = true)
        val name = f.path.substringAfterLast('/')
        val shown = openFile == f.path
        ListRow(name, parentOf(f.path).ifEmpty { null }, lines = 1, selected = shown, leading = { FileTag(name) }, trailing = { Counts(f.additions, f.deletions) }, onClick = { onOpenFile(if (shown) null else f.path) })
        if (shown) diffs?.let { PatchView(it[f.path] ?: "No diff", f.path) }
    }
}

@Composable
fun PatchView(patch: String, path: String) {
    val lines = remember(patch) { patchLines(patch) }
    val lang = langOf(path)
    val scroll = rememberScrollState()
    Column(Modifier.padding(bottom = Tokens.sp4)) {
        lines.take(PR_DIFF_LINES).forEach { l -> DiffCodeLine(l, lang, wrap = false, scroll = scroll) }
        if (lines.size > PR_DIFF_LINES) Hint("${lines.size - PR_DIFF_LINES} more lines")
    }
}

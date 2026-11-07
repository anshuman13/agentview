package no.pradhan.agentview.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString

// Pull Requests (web/src/ops/GitHub.tsx): the repo's open PRs in three groups, and a PR page with review actions.
@Composable
fun PullsScreen(hub: Hub, onBack: () -> Unit) {
    val st by hub.store.state.collectAsState()
    val chat = st.shownId
    var fresh by remember { mutableStateOf(false) }
    val (load, reload) = rememberLoad(chat) { parsePulls(hub.read("/api/gh/prs" + if (fresh) "?fresh=1" else "")) }
    var open by rememberSaveable(chat) { mutableStateOf<Int?>(null) }
    val pr = load.data?.firstOrNull { it.number == open }
    if (pr != null) { PullScreen(hub, pr, onBack = { open = null }, onChanged = { fresh = true; reload() }); return }
    val now = System.currentTimeMillis()

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Pull Requests", onBack) { IconBtn(Icons.Filled.Refresh, "Refresh", { fresh = true; reload() }, enabled = !load.busy) }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                val problem = ghProblem(load.error)
                when {
                    problem != null -> item { EmptyState(problem.title, problem.text + (problem.cmd?.let { "\n$it" } ?: ""), small = false) }
                    load.error.isNotEmpty() -> item { ErrorHint(load.error) }
                    load.data == null -> item { Hint("Loading") }
                    else -> prGroups(load.data).forEach { g ->
                        item(key = g.title) {
                            var shown by rememberSaveable(g.title) { mutableStateOf(true) }
                            Column {
                                SectionHeader(g.title, g.prs.size.toString(), open = shown, onToggle = { shown = !shown })
                                if (shown) Group {
                                    if (g.prs.isEmpty()) EmptyState(g.empty)
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
        pr.title, "#${pr.number} · ${pr.author} · ${pr.branch} · ${agoShort(isoMillis(pr.updatedAt), now)}",
        leading = { StatusDot(checkDot(pr.checks)) },
        trailing = { PrState(pr) },
        onClick = onClick,
    )
}

private const val PR_DIFF_LINES = 400

@Composable
private fun PullScreen(hub: Hub, pr: PullRequest, onBack: () -> Unit, onChanged: () -> Unit) {
    BackHandler(onBack = onBack)
    val (load, reload) = rememberLoad(pr.number, pr.sha) { parsePullDetail(hub.read("/api/gh/pr/${pr.number}")) }
    val d = load.data
    val diffs = remember(d?.diff) { splitDiff(d?.diff ?: "") }
    val link = openLink()
    var text by rememberSaveable(pr.number) { mutableStateOf("") }
    var busy by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    var openFile by rememberSaveable(pr.number) { mutableStateOf<String?>(null) }
    val now = System.currentTimeMillis()
    fun act(label: String, path: String, body: String, done: () -> Unit = {}) {
        busy = label
        hub.write("/api/gh/pr/${pr.number}/$path", body, "Could not $label") { ok -> busy = ""; if (ok) { done(); reload(); onChanged() } }
    }

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "#${pr.number}", onBack, sub = pr.branch) {
            MoreButton { close ->
                MenuItem("Open on GitHub", { close(); link(pr.url) })
                MenuSeparator()
                MERGE_METHODS.forEach { (m, label) ->
                    MenuItem(if (m == "merge") "Merge with a merge commit" else "Merge: $label", { close(); confirm = "Merge #${pr.number} (${label.lowercase()})?" to { act("merge", "merge", mergeBody(m)) } }, enabled = busy.isEmpty())
                }
                MenuItem("Check out ${pr.branch}", { close(); act("checkout", "checkout", "{}") }, enabled = busy.isEmpty())
            }
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Group(Modifier.padding(top = Tokens.sp4)) {
                        ListRow(pr.title, "${pr.author} · ${pr.branch} · ${agoShort(isoMillis(pr.updatedAt), now)}", lines = 3, leading = { StatusDot(checkDot(pr.checks)) }, trailing = { Counts(pr.additions, pr.deletions); PrState(pr) })
                    }
                }
                if (busy.isNotEmpty()) item { Hint("Running ${busy.replace('_', ' ')}...") }
                item { ErrorHint(load.error) }
                if (d == null) { if (load.error.isEmpty()) item { Hint("Loading") } }
                else {
                    item { SectionHeader("Description") }
                    item { Group { if (d.body.isBlank()) EmptyState("No description") else Column(Modifier.padding(Tokens.sp7)) { Markdown(d.body) } } }
                    item { SectionHeader("Checks", d.checks.size.toString()) }
                    item {
                        Group {
                            if (d.checks.isEmpty()) EmptyState("No checks")
                            d.checks.forEachIndexed { i, c ->
                                if (i > 0) Hairline(lead = true)
                                ListRow(c.name, lines = 1, leading = { StatusDot(checkDot(c.state)) }, onClick = if (c.url.isNotEmpty()) ({ link(c.url) }) else null)
                            }
                        }
                    }
                    item { SectionHeader("Reviews", d.reviews.size.toString()) }
                    item {
                        Group {
                            if (d.reviews.isEmpty()) EmptyState("No reviews")
                            d.reviews.forEachIndexed { i, r ->
                                if (i > 0) Hairline()
                                ListRow(r.author, agoShort(isoMillis(r.at), now), trailing = { reviewLabel(r.state)?.let { (l, t) -> Tag(l, t) } })
                                if (r.body.isNotBlank()) Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp6)) { Markdown(r.body) }
                            }
                        }
                    }
                    item { SectionHeader("Commits", d.commits.size.toString()) }
                    item {
                        Group {
                            if (d.commits.isEmpty()) EmptyState("No commits")
                            d.commits.forEachIndexed { i, c ->
                                if (i > 0) Hairline()
                                ListRow(firstLine(c.message), shortSha(c.oid))
                            }
                        }
                    }
                    item { SectionHeader("Files changed", d.files.size.toString()) }
                    item {
                        Group {
                            if (d.files.isEmpty()) EmptyState("No files")
                            d.files.forEachIndexed { i, f ->
                                if (i > 0) Hairline(lead = true)
                                val name = f.path.substringAfterLast('/')
                                val shown = openFile == f.path
                                ListRow(name, parentOf(f.path).ifEmpty { null }, lines = 1, selected = shown, leading = { FileTag(name) }, trailing = { Counts(f.additions, f.deletions) }, onClick = { openFile = if (shown) null else f.path })
                                if (shown) PatchView(diffs[f.path] ?: "No diff", f.path)
                            }
                        }
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp8)) }
            }
        }
        HorizontalDivider(color = av.border, thickness = Tokens.hairline)
        Column(Modifier.fillMaxWidth().padding(Tokens.sp6), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            TextField(text, { text = it }, placeholder = "Leave a comment", maxLines = 4)
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Button("Approve", { confirm = "Approve #${pr.number}?" to { act("approve", "review", reviewBody("approve", text)) { text = "" } } }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = busy.isEmpty())
                Button("Request changes", { act("request_changes", "review", reviewBody("request_changes", text)) { text = "" } }, size = ButtonSize.Sm, enabled = busy.isEmpty() && text.isNotBlank())
                Button("Comment", { act("comment", "review", reviewBody("comment", text)) { text = "" } }, size = ButtonSize.Sm, enabled = busy.isEmpty() && text.isNotBlank())
            }
        }
    }
    confirm?.let { (title, run) -> ConfirmDialog(title, pr.title, title.substringBefore(' '), run, danger = false, onDismiss = { confirm = null }) }
}

@Composable
private fun PatchView(patch: String, path: String) {
    val lines = remember(patch) { patch.trimEnd('\n').split('\n') }
    val lang = langOf(path)
    val scroll = rememberScrollState()
    Column(Modifier.padding(bottom = Tokens.sp4)) {
        lines.take(PR_DIFF_LINES).forEach { l ->
            val mark = diffMark(l)
            val body = if (mark == '@' || l.isEmpty()) l else l.substring(1)
            CodeLine(if (mark == '@') "" else mark.toString(), if (mark == '@') AnnotatedString(body) else highlighted(body, highlightLine(body, lang).first), mark, wrap = false, scroll = scroll)
        }
        if (lines.size > PR_DIFF_LINES) Hint("${lines.size - PR_DIFF_LINES} more lines")
    }
}

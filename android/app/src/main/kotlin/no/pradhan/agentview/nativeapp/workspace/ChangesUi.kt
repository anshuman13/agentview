package no.pradhan.agentview.nativeapp.workspace

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.icon
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.image
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.saveFile
import no.pradhan.agentview.nativeapp.net.write
import no.pradhan.agentview.nativeapp.ops.DRAFT_PROMPT
import no.pradhan.agentview.nativeapp.ops.Findings
import no.pradhan.agentview.nativeapp.ops.PatchView
import no.pradhan.agentview.nativeapp.ops.REVIEW_LOCAL
import no.pradhan.agentview.nativeapp.sessions.since
import no.pradhan.agentview.nativeapp.sessions.state
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.RowLabel
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.WhileStarted
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.color

// Source Control (web/src/workspace/Changes.tsx): branch, commit box, staged and unstaged files, a file opens as its diff.
@Composable
fun ChangesScreen(hub: Hub, onBack: () -> Unit) {
    val st by hub.store.state.collectAsState()
    val chat = st.shownId
    var open by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    var pager by rememberSaveable(chat) { mutableStateOf<List<String>?>(null) }
    var reviewed by rememberSaveable(chat) { mutableStateOf(listOf<String>()) }
    var message by rememberSaveable(chat) { mutableStateOf("") }
    var ask by androidx.compose.runtime.remember { mutableStateOf<List<GitFile>?>(null) }
    val o = open
    if (o != null) { FileScreen(hub, o, onBack = { open = null }); return }
    val (load, reload) = rememberLoad(chat) { parseGitStatus(hub.read("/api/git/status")) }
    val pg = pager
    if (pg != null) {
        ChangesPager(hub, pg.drop(1), pg[0].toInt(), reviewed.toSet(), { reviewed = reviewed + it }, { p ->
            val rest = pg.drop(1) - p
            reviewed = reviewed - p
            reload()
            pager = if (rest.isEmpty()) null else listOf(minOf(pg[0].toInt(), rest.size - 1).toString()) + rest
        }, onBack = { pager = null; reload() })
        return
    }
    val (branchLoad, reloadBranch) = rememberLoad(chat) { parseBranchDiff(hub.read("/api/git/branch")) }
    var shownPatch by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    WhileStarted(chat) { while (true) { delay(5000); reload() } }
    val status = load.data
    val files = status?.files ?: emptyList()
    val staged = files.filter { it.staged }
    val changes = files.filter { !it.staged }
    val review = files.map { it.path }.distinct()
    val openReview = { f: GitFile -> pager = listOf(review.indexOf(f.path).toString()) + review }
    fun run(action: String, body: String, done: () -> Unit = {}) = hub.write("/api/git/$action", body, "Could not $action") { if (it) done(); reload() }

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Source Control", onBack) {
            IconBtn("refresh", "Refresh", { reload(); reloadBranch() })
            MoreButton { close ->
                MenuItem("Write message with Claude", "sparkle", { close(); hub.askClaude(DRAFT_PROMPT) }, enabled = staged.isNotEmpty())
                MenuItem("Review changes with Claude", "sparkle", { close(); hub.askClaude(REVIEW_LOCAL) }, enabled = files.isNotEmpty())
            }
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Group(Modifier.padding(top = Tokens.sp4)) {
                        val ab = listOfNotNull(status?.behind?.takeIf { it > 0 }?.let { "$it behind" }, status?.ahead?.takeIf { it > 0 }?.let { "$it ahead" }).joinToString(" · ")
                        ListRow(status?.branch?.ifEmpty { null } ?: if (status == null) "Loading…" else "No branch", ab.ifEmpty { null }, lines = 1)
                    }
                }
                item {
                    Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp8)) {
                        TextField(message, { message = it }, placeholder = "Message${status?.branch?.let { " (commit on $it)" } ?: ""}", minLines = 1, maxLines = 6)
                        Button("Commit", { run("commit", commitBody(message)) { message = "" } }, variant = ButtonVariant.Filled, enabled = staged.isNotEmpty() && message.isNotBlank(), fill = true)
                    }
                }
                item { ErrorHint(load.error) }
                if (staged.isNotEmpty()) {
                    item {
                        SectionHeader("Staged Changes", staged.size.toString(), action = {
                            MoreButton { close -> MenuItem("Unstage All Changes", "remove", { close(); run("unstage", pathsBody(staged)) }) }
                        })
                    }
                    item { FileGroup(staged, onOpen = openReview) { f, close -> MenuItem("Unstage Changes", "remove", { close(); run("unstage", pathsBody(listOf(f))) }) } }
                }
                if (changes.isNotEmpty()) {
                    item {
                        SectionHeader("Changes", changes.size.toString(), action = {
                            MoreButton { close ->
                                MenuItem("Stage All Changes", "add", { close(); run("stage", pathsBody(changes)) })
                                MenuItem("Discard All Changes", "discard", { close(); ask = changes }, danger = true)
                            }
                        })
                    }
                    item {
                        FileGroup(changes, onOpen = openReview) { f, close ->
                            MenuItem("Stage Changes", "add", { close(); run("stage", pathsBody(listOf(f))) })
                            MenuItem("Discard Changes", "discard", { close(); ask = listOf(f) }, danger = true)
                        }
                    }
                }
                if (status != null && files.isEmpty()) item { EmptyState("No changes", icon = "source-control", small = false) }
                branchLoad.data?.takeIf { it.files.isNotEmpty() }?.let { b ->
                    val patches = splitDiff(b.diff)
                    item { SectionHeader("Committed since ${b.base}", b.files.size.toString()) }
                    item {
                        Group {
                            b.files.forEachIndexed { i, f ->
                                if (i > 0) Hairline(lead = true)
                                val name = f.path.substringAfterLast('/')
                                val shown = shownPatch == f.path
                                ListRow(name, parentOf(f.path).ifEmpty { null }, lines = 1, selected = shown, leading = { FileTag(name) }, trailing = { Counts(f.add, f.del) }, onClick = { shownPatch = if (shown) null else f.path })
                                if (shown) PatchView(patches[f.path] ?: if (b.diff.isEmpty()) "Diff too large to show" else "No diff", f.path)
                            }
                        }
                    }
                }
                item { Column { Findings(hub, "local") { open = it.file } } }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
    ask?.let { list ->
        ConfirmDialog(discardTitle(list), discardDetail(list), if (list.any { it.status == "?" }) "Discard and Delete" else "Discard", { run("discard", pathsBody(list)) }, onDismiss = { ask = null })
    }
}

@Composable
private fun letterColor(letter: String): Color = when (letter) {
    "A", "U" -> av.ok
    "D" -> av.err
    else -> av.modified
}

@Composable
private fun FileGroup(files: List<GitFile>, onOpen: (GitFile) -> Unit, menu: @Composable androidx.compose.foundation.layout.ColumnScope.(GitFile, () -> Unit) -> Unit) {
    val haptic = LocalHapticFeedback.current
    Group {
        files.forEachIndexed { i, f ->
            if (i > 0) Hairline(lead = true)
            val name = f.path.substringAfterLast('/')
            val letter = letterOf(f)
            val open = remember(f.path) { mutableStateOf(false) }
            ListRow(
                name, parentOf(f.path).ifEmpty { null }, lines = 2, metaLines = 2, strike = f.status == "D",
                leading = { FileTag(name) },
                trailing = {
                    RowLabel(letter, letterColor(letter))
                    MoreButton(expanded = open) { close ->
                        MenuItem("Open File", "go-to-file", { close(); onOpen(f) })
                        menu(f, close)
                    }
                },
                onClick = { onOpen(f) },
                onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); open.value = true },
            )
        }
    }
}

// Review pager: swipe between the changed files, each a line diff with Keep and Revert below.
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ChangesPager(hub: Hub, paths: List<String>, start: Int, reviewed: Set<String>, onKeep: (String) -> Unit, onReverted: (String) -> Unit, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val pager = androidx.compose.foundation.pager.rememberPagerState(initialPage = start.coerceIn(0, maxOf(0, paths.size - 1))) { paths.size }
    val counts = remember { androidx.compose.runtime.mutableStateMapOf<String, Pair<Int, Int>>() }
    var ask by remember { mutableStateOf<String?>(null) }
    var comment by remember { mutableStateOf<Triple<String, DiffRow, (() -> Unit)?>?>(null) }
    if (paths.isEmpty()) { LaunchedEffect(Unit) { onBack() }; return }
    val path = paths[pager.currentPage.coerceIn(0, paths.lastIndex)]
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val c = counts[path]

    Column(Modifier.fillMaxSize()) {
        PageHeader(path.substringAfterLast('/'), onBack, subtitle = {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Text("${paths.indexOf(path) + 1} of ${paths.size}", maxLines = 1)
                if (c != null) {
                    Text("+${c.first}", color = av.diffAdd, maxLines = 1)
                    Text("-${c.second}", color = av.diffDel, maxLines = 1)
                }
                parentOf(path).ifEmpty { null }?.let { Text(it, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
            }
        })
        androidx.compose.foundation.pager.HorizontalPager(pager, Modifier.weight(1f), key = { paths.getOrElse(it) { "" } }) { page ->
            val p = paths[page]
            ReviewPage(hub, p, onCounts = { counts[p] = it }, onComment = { row, revert -> comment = Triple(p, row, revert) })
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp8)) {
            val kept = path in reviewed
            Button(if (kept) "Kept" else "Keep", {
                onKeep(path)
                if (pager.currentPage < paths.size - 1) scope.launch { pager.animateScrollToPage(pager.currentPage + 1) }
            }, Modifier.weight(1f), variant = if (kept) ButtonVariant.Tinted else ButtonVariant.Gray, icon = "check", fill = true)
            Button("Revert", { ask = path }, Modifier.weight(1f), variant = ButtonVariant.Danger, icon = "discard", enabled = !hub.readOnly, fill = true)
        }
    }
    ask?.let { p ->
        ConfirmDialog(revertTitle(p), REVERT_DETAIL, "Revert", { hub.write("/api/git/revert", pathsBody(listOf(GitFile(p))), "Could not revert") { if (it) onReverted(p) } }, onDismiss = { ask = null })
    }
    comment?.let { (p, row, revert) ->
        CommentSheet("Comment on ${p.substringAfterLast('/')}:${row.no}", row.line.text, onSend = { text -> hub.draftPrompt(commentPrompt(p, row, text)) }, onRevert = revert?.takeIf { !hub.readOnly }, onDismiss = { comment = null })
    }
}

@Composable
private fun ReviewPage(hub: Hub, path: String, onCounts: (Pair<Int, Int>) -> Unit, onComment: (DiffRow, (() -> Unit)?) -> Unit) {
    val (load, reload) = rememberLoad(path, hub.pageChat) { parseFile(hub.read("/api/file?path=${enc(path)}")) }
    val file = load.data
    when {
        file == null && load.error.isNotEmpty() -> ErrorHint(load.error)
        file == null -> Hint("Loading…")
        file.error != null -> EmptyState(fileError(file.error))
        file.image -> EmptyState("Image file")
        file.binary -> EmptyState("Binary file")
        else -> {
            val lines = remember(file) { fileDiffLines(file.original, file.content) }
            val rows = remember(lines) { diffRows(lines, true) }
            LaunchedEffect(lines) { onCounts(diffCounts(lines)) }
            NumberedDiffView(rows, langOf(path), true) { row ->
                val k = blockOf(lines, row.line)
                onComment(row, if (k < 0 || file.original.isEmpty()) null else ({ hub.saveFile(path, revertBlock(lines, k)) { if (it) reload() } }))
            }
        }
    }
}

@Composable
fun CommentSheet(title: String, quote: String, onSend: (String) -> Unit, onDismiss: () -> Unit, initial: String = "", sendLabel: String = "Send to composer", onRevert: (() -> Unit)? = null) {
    var text by rememberSaveable { mutableStateOf(initial) }
    Sheet(onDismiss, title) {
        Column(Modifier.padding(horizontal = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp8)) {
            Text(quote, style = Mono, color = av.fgMuted, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            TextField(text, { text = it }, placeholder = "Comment", minLines = 2, maxLines = 6)
            Button(sendLabel, { onSend(text); onDismiss() }, variant = ButtonVariant.Filled, enabled = text.isNotBlank(), fill = true)
            if (onRevert != null) Button("Revert this change", { onRevert(); onDismiss() }, variant = ButtonVariant.Danger, icon = "discard", fill = true)
        }
    }
}

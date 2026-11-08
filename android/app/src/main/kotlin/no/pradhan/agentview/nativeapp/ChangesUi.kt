package no.pradhan.agentview.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
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
    LaunchedEffect(chat) { while (true) { delay(5000); reload() } }
    val status = load.data
    val files = status?.files ?: emptyList()
    val staged = files.filter { it.staged }
    val changes = files.filter { !it.staged }
    val review = files.map { it.path }.distinct()
    val openReview = { f: GitFile -> pager = listOf(review.indexOf(f.path).toString()) + review }
    fun run(action: String, body: String, done: () -> Unit = {}) = hub.write("/api/git/$action", body, "Could not $action") { if (it) done(); reload() }

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Source Control", onBack) {
            IconBtn("refresh", "Refresh", reload)
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
                        ListRow(status?.branch?.ifEmpty { null } ?: if (status == null) "Loading" else "No branch", ab.ifEmpty { null }, lines = 1)
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
    var comment by remember { mutableStateOf<Pair<String, DiffRow>?>(null) }
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
            ReviewPage(hub, p, onCounts = { counts[p] = it }, onComment = { comment = p to it })
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
    comment?.let { (p, row) ->
        CommentSheet(p, row, onSend = { text -> hub.draftPrompt(commentPrompt(p, row, text)) }, onDismiss = { comment = null })
    }
}

@Composable
private fun ReviewPage(hub: Hub, path: String, onCounts: (Pair<Int, Int>) -> Unit, onComment: (DiffRow) -> Unit) {
    val (load, _) = rememberLoad(path, hub.pageChat) { parseFile(hub.read("/api/file?path=${enc(path)}")) }
    val file = load.data
    when {
        file == null && load.error.isNotEmpty() -> ErrorHint(load.error)
        file == null -> Hint("Loading")
        file.error != null -> EmptyState(fileError(file.error))
        file.image -> EmptyState("Image file")
        file.binary -> EmptyState("Binary file")
        else -> {
            val lines = remember(file) { fileDiffLines(file.original, file.content) }
            val rows = remember(lines) { diffRows(lines, true) }
            LaunchedEffect(lines) { onCounts(diffCounts(lines)) }
            NumberedDiffView(rows, langOf(path), false, onComment)
        }
    }
}

@Composable
private fun CommentSheet(path: String, row: DiffRow, onSend: (String) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    Sheet(onDismiss, "Comment on ${path.substringAfterLast('/')}:${row.no}") {
        Column(Modifier.padding(horizontal = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp8)) {
            Text(row.line.text, style = Mono, color = av.fgMuted, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            TextField(text, { text = it }, placeholder = "Comment", minLines = 2, maxLines = 6)
            Button("Send to composer", { onSend(text); onDismiss() }, variant = ButtonVariant.Filled, enabled = text.isNotBlank(), fill = true)
        }
    }
}

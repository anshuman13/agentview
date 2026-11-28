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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
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
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.branchDiff
import no.pradhan.agentview.nativeapp.app.branches
import no.pradhan.agentview.nativeapp.ui.ChoiceRow
import no.pradhan.agentview.nativeapp.app.commitDiff
import no.pradhan.agentview.nativeapp.app.git
import no.pradhan.agentview.nativeapp.app.gitStatus
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.app.readFile
import no.pradhan.agentview.nativeapp.app.saveFile

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
import no.pradhan.agentview.nativeapp.ui.agoShort
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.plural
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.Loaded
import no.pradhan.agentview.nativeapp.ui.rememberLoad

private class GitOps(val hub: Hub, val cwd: String, private val reload: () -> Unit, val onDiscard: (List<GitFile>) -> Unit, val viewed: Map<String, String>, val hashes: Map<String, String>, val toggleViewed: (GitFile) -> Unit, val onReview: (GitFile) -> Unit) {
    fun isViewed(f: GitFile) = rowKey(f) in viewed
    fun canView(f: GitFile) = hashes[rowKey(f)] != null
    fun run(action: String, body: String, done: () -> Unit = {}) = hub.git(action, body, "Could not $action") { if (it) done(); reload() }
}

// Source Control (web/src/workspace/Changes.tsx): branch, commit box, staged and unstaged files, a file opens as its diff.
@Composable
fun ChangesScreen(hub: Hub, onBack: () -> Unit) {
    val shownId by hub.store.state.select { it.shownId }
    val provider by hub.store.state.select { it.session?.provider }
    val chat = shownId
    val cwd by hub.store.state.select { s -> s.session?.cwd ?: s.live.firstOrNull { it.id == s.shownId }?.cwd ?: "" }
    var base by remember(cwd) { mutableStateOf(hub.prefs.getString(compareBaseKey(cwd), null)) }
    var basePick by remember { mutableStateOf<BranchList?>(null) }
    var seen by remember(cwd) { mutableStateOf(decodeViewed(hub.prefs.getString(viewedKey(cwd), null))) }
    val pickBase = { b: String? ->
        hub.prefs.edit().apply { if (b == null) remove(compareBaseKey(cwd)) else putString(compareBaseKey(cwd), b) }.apply()
        base = b
    }
    var open by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    var openLine by rememberSaveable(chat) { mutableStateOf<Int?>(null) }
    var pager by rememberSaveable(chat) { mutableStateOf<List<String>?>(null) }
    var reviewed by rememberSaveable(chat) { mutableStateOf(listOf<String>()) }
    val message = rememberSaveable(chat) { mutableStateOf("") }
    val shownPatch = rememberSaveable(chat) { mutableStateOf(listOf<String>()) }
    var hideWs by remember { mutableStateOf(hub.prefs.getBoolean(HIDE_WS_KEY, false)) }
    val diffMenu = DiffMenu(hideWs, { hideWs = it; hub.prefs.edit().putBoolean(HIDE_WS_KEY, it).apply() })
    var ask by androidx.compose.runtime.remember { mutableStateOf<List<GitFile>?>(null) }
    val o = open
    if (o != null) { FileScreen(hub, o, onBack = { open = null; openLine = null }, line = openLine); return }
    val (load, reload) = rememberLoad(chat) { hub.gitStatus() }
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
    val (branchLoad, reloadBranch) = rememberLoad(chat, base, hideWs) { hub.branchDiff(base, hideWs) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val openBases = { scope.launch { basePick = runCatching { hub.branches() }.getOrElse { BranchList() } }; Unit }
    val pick = rememberSaveable(chat) { mutableStateOf<String?>(null) }
    val (commitLoad, _) = rememberLoad(chat, pick.value, hideWs) { pick.value?.let { hub.commitDiff(it, hideWs) } }
    // A file the agent or watcher reports changed refreshes after the burst; the slow poll catches git commands run outside.
    LaunchedEffect(hub, chat) { hub.fileChanged.collectLatest { delay(300); reload() } }
    WhileStarted(chat) { while (true) { delay(30_000); reload() } }
    val files = load.data?.files ?: emptyList()
    val review = files.map { it.path }.distinct()
    val label = providerLabel(provider)
    val hashes = load.data?.hashes ?: emptyMap()
    val toggleViewed = { f: GitFile ->
        seen = viewedAfter(seen, hashes, rowKey(f))
        hub.prefs.edit().putString(viewedKey(cwd), encodeViewed(seen)).apply()
    }
    val ops = GitOps(hub, cwd, reload, { ask = it }, viewedAfter(seen, hashes), hashes, toggleViewed) { f -> pager = listOf(review.indexOf(f.path).toString()) + review }

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Source control", onBack) {
            MoreButton { close ->
                MenuItem("Refresh", "refresh", { close(); reload(); reloadBranch() })
                MenuItem("Write message with $label", "sparkle", { close(); hub.askChat(DRAFT_PROMPT) }, enabled = files.any { it.staged })
                MenuItem("Review changes with $label", "sparkle", { close(); hub.askChat(REVIEW_LOCAL) }, enabled = files.isNotEmpty())
            }
        }
        PageBody { ChangesList(hub, load, branchLoad.data, base != null, openBases, Picked(pick, commitLoad), ops, message, shownPatch, diffMenu) { open = it.file; openLine = it.line } }
    }
    basePick?.let { list ->
        val current = branchLoad.data?.base
        Sheet({ basePick = null }, "Compare against", padded = false, full = false) {
            Group {
                list.branches.forEachIndexed { i, b ->
                    if (i > 0) Hairline()
                    ChoiceRow(b, if (b == list.base) "default" else null, checked = b == current, onClick = { basePick = null; pickBase(b.takeIf { it != list.base }) })
                }
            }
        }
    }
    ask?.let { list ->
        ConfirmDialog(discardTitle(list), discardDetail(list), if (list.any { it.status == "?" }) "Discard and Delete" else "Discard", { ops.run("discard", pathsBody(list)) }, onDismiss = { ask = null })
    }
}

@Composable
private fun ChangesList(hub: Hub, load: Loaded<GitStatus>, branch: BranchDiff?, basePicked: Boolean, onBases: () -> Unit, picked: Picked, ops: GitOps, message: MutableState<String>, shownPatch: MutableState<List<String>>, diffMenu: DiffMenu, onOpenFinding: (Finding) -> Unit) {
    val status = load.data
    val files = status?.files ?: emptyList()
    val staged = files.filter { it.staged }
    val changes = files.filter { !it.staged }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Group(Modifier.padding(top = Tokens.sp4)) {
                val ab = listOfNotNull(status?.behind?.takeIf { it > 0 }?.let { "$it behind" }, status?.ahead?.takeIf { it > 0 }?.let { "$it ahead" }).joinToString(" · ")
                ListRow(status?.branch?.ifEmpty { null } ?: if (status == null) "Loading…" else "No branch", ab.ifEmpty { null })
            }
        }
        item {
            Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp8)) {
                TextField(message.value, { message.value = it }, placeholder = "Message${status?.branch?.let { " (commit on $it)" } ?: ""}", minLines = 1, maxLines = 6)
                Button("Commit", { ops.run("commit", commitBody(message.value)) { message.value = "" } }, variant = ButtonVariant.Filled, enabled = staged.isNotEmpty() && message.value.isNotBlank(), fill = true)
            }
        }
        item { ErrorHint(load.error) }
        stagedSection(staged, ops)
        changesSection(changes, ops)
        if (status != null && files.isEmpty()) item { EmptyState("No changes", icon = "source-control", small = false) }
        branch?.takeIf { it.files.isNotEmpty() || basePicked }?.let { committedSection(it, status?.branch, onBases, picked, shownPatch, diffMenu) }
        item { Column { Findings(hub, "local", onOpenFinding) } }
        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
    }
}

private fun LazyListScope.stagedSection(staged: List<GitFile>, ops: GitOps) {
    if (staged.isEmpty()) return
    item {
        SectionHeader("Staged changes", staged.size.toString(), action = {
            MoreButton { close -> MenuItem("Unstage All Changes", "remove", { close(); ops.run("unstage", pathsBody(staged)) }) }
        })
    }
    item { FileGroup(staged, ops) { f, close -> MenuItem("Unstage Changes", "remove", { close(); ops.run("unstage", pathsBody(listOf(f))) }) } }
}

private fun LazyListScope.changesSection(changes: List<GitFile>, ops: GitOps) {
    if (changes.isEmpty()) return
    item {
        SectionHeader("Changes", changes.size.toString(), action = {
            MoreButton { close ->
                MenuItem("Stage All Changes", "add", { close(); ops.run("stage", pathsBody(changes)) })
                MenuItem("Discard All Changes", "discard", { close(); ops.onDiscard(changes) }, danger = true)
            }
        })
    }
    item {
        FileGroup(changes, ops) { f, close ->
            MenuItem("Stage Changes", "add", { close(); ops.run("stage", pathsBody(listOf(f))) })
            MenuItem("Discard Changes", "discard", { close(); ops.onDiscard(listOf(f)) }, danger = true)
        }
    }
}

// The commit picked in "Committed since <base>" and its loaded files; null shows all of the branch.
private class Picked(val hash: MutableState<String?>, val load: Loaded<BranchDiff?>)

private class DiffMenu(val hideWs: Boolean, val setHideWs: (Boolean) -> Unit)

// Claude Code's Commits list: "All changes", then each commit with its sha and age; a picked commit shows only its files.
private fun LazyListScope.committedSection(b: BranchDiff, branch: String?, onBases: () -> Unit, picked: Picked, shownPatch: MutableState<List<String>>, menu: DiffMenu) {
    val pick = picked.hash.value?.takeIf { h -> b.commits.any { it.hash == h } }
    val shown = if (pick == null) b else picked.load.data
    item {
        SectionHeader(committedLabel(branch, b.base), b.files.size.toString(), action = {
            if (branch != b.base) IconBtn("git-branch", "Compare against", onBases, iconSize = Tokens.icon)
            MoreButton { close ->
                MenuItem("Collapse all files", "collapse-all", { close(); shownPatch.value = emptyList() })
                MenuItem("Expand all files", "expand-all", { close(); shownPatch.value = (if (pick == null) b else picked.load.data)?.files?.map { it.path } ?: emptyList() })
                MenuSeparator()
                MenuItem("Hide whitespace changes", "", { close(); menu.setHideWs(!menu.hideWs) }, checked = menu.hideWs)
            }
        })
    }
    if (b.commits.size > 1) item {
        val now = System.currentTimeMillis()
        Group(Modifier.padding(bottom = Tokens.sp8)) {
            ListRow("All changes", plural(b.commits.size, "commit"), lines = 1, selected = pick == null, onClick = { picked.hash.value = null; shownPatch.value = emptyList() })
            b.commits.forEach { c ->
                Hairline()
                ListRow(c.subject, "${c.hash} · ${agoShort(c.at, now)}", lines = 1, metaLines = 1, selected = pick == c.hash, onClick = { picked.hash.value = if (pick == c.hash) null else c.hash; shownPatch.value = emptyList() })
            }
        }
    }
    if (shown == null) {
        item { if (picked.load.error.isNotEmpty()) ErrorHint(picked.load.error) else EmptyState("Loading…", icon = "git-commit") }
        return
    }
    val patches = splitDiff(shown.diff)
    item {
        Group {
            shown.files.forEachIndexed { i, f ->
                if (i > 0) Hairline(lead = true)
                val name = f.path.substringAfterLast('/')
                val open = f.path in shownPatch.value
                ListRow(name, parentOf(f.path).ifEmpty { null }, selected = open, leading = { FileTag(name) }, trailing = { Counts(f.additions, f.deletions) }, onClick = { shownPatch.value = toggledOpen(shownPatch.value, f.path) })
                if (open) PatchView(patches[f.path] ?: if (shown.diff.isEmpty()) "Diff too large to show" else "No diff", f.path)
            }
        }
    }
}

@Composable
private fun letterColor(letter: String): Color = when (letter) {
    "A", "U" -> av.ok
    "D" -> av.err
    else -> av.modified
}

@Composable
private fun FileGroup(files: List<GitFile>, ops: GitOps, menu: @Composable androidx.compose.foundation.layout.ColumnScope.(GitFile, () -> Unit) -> Unit) {
    val haptic = LocalHapticFeedback.current
    Group {
        files.forEachIndexed { i, f ->
            if (i > 0) Hairline(lead = true)
            val name = f.path.substringAfterLast('/')
            val letter = letterOf(f)
            val open = remember(f.path) { mutableStateOf(false) }
            val viewed = ops.isViewed(f)
            ListRow(
                name, parentOf(f.path).ifEmpty { null }, lines = 2, metaLines = 2, strike = f.status == "D",
                muted = viewed,
                leading = { FileTag(name) },
                trailing = {
                    if (ops.canView(f)) IconBtn(if (viewed) "pass-filled" else "circle-large-outline", if (viewed) "Mark as not viewed" else "Mark as viewed", { ops.toggleViewed(f) }, on = viewed, tint = if (viewed) av.ok else av.fgMuted, iconSize = Tokens.icon)
                    RowLabel(letter, letterColor(letter))
                    MoreButton(expanded = open) { close ->
                        MenuItem("Attach as context", "mention", { close(); ops.hub.draftPrompt(mentionOf(f.path, ops.cwd) + " ") })
                        MenuItem("Open File", "go-to-file", { close(); ops.onReview(f) })
                        if (ops.canView(f)) MenuItem(if (viewed) "Mark as not viewed" else "Mark as viewed", if (viewed) "circle-large-outline" else "pass", { close(); ops.toggleViewed(f) })
                        menu(f, close)
                        MenuSeparator()
                        CopyPathItems(ops.hub, f.path, ops.cwd, close)
                    }
                },
                onClick = { ops.onReview(f) },
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
            Button("Discard", { ask = path }, Modifier.weight(1f), variant = ButtonVariant.Danger, icon = "discard", enabled = !hub.readOnly, fill = true)
        }
    }
    ask?.let { p ->
        ConfirmDialog(revertTitle(p), REVERT_DETAIL, "Discard", { hub.git("revert", pathsBody(listOf(GitFile(p))), "Could not revert") { if (it) onReverted(p) } }, onDismiss = { ask = null })
    }
    comment?.let { (p, row, revert) ->
        CommentSheet("Comment on ${p.substringAfterLast('/')}:${row.no}", row.line.text, onSend = { text -> hub.draftPrompt(commentPrompt(p, row, text)) }, onRevert = revert?.takeIf { !hub.readOnly }, onDismiss = { comment = null })
    }
}

@Composable
private fun ReviewPage(hub: Hub, path: String, onCounts: (Pair<Int, Int>) -> Unit, onComment: (DiffRow, (() -> Unit)?) -> Unit) {
    val (load, reload) = rememberLoad(path, hub.pageChat) { hub.readFile(path) }
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

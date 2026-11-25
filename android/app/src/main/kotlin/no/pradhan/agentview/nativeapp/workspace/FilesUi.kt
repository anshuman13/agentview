package no.pradhan.agentview.nativeapp.workspace

import no.pradhan.agentview.nativeapp.ui.DiffLine
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.chat.ChatImage
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.readDir
import no.pradhan.agentview.nativeapp.app.readFile
import no.pradhan.agentview.nativeapp.app.track
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.lazyGroup
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.rememberLoad

// Files (web/src/workspace/Explorer.tsx and CodePane.tsx): the repo tree of the chat's folder and a file view.
@Composable
fun FilesScreen(hub: Hub, onBack: () -> Unit) {
    val shownId by hub.store.state.select { it.shownId }
    val chat = shownId
    var open by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    val dirs = remember(chat) { mutableStateMapOf<String, List<DirEntry>>() }
    var expanded by rememberSaveable(chat) { mutableStateOf(listOf<String>()) }
    var showHidden by rememberSaveable { mutableStateOf(false) }
    var error by remember(chat) { mutableStateOf("") }
    val (rows, missing) = treeRows(dirs, expanded.toSet(), showHidden)
    val loading = remember(chat) { mutableStateMapOf<String, Boolean>() }
    var refresh by remember { mutableStateOf(0) }
    var copying by remember(chat) { mutableStateOf<String?>(null) }
    val cwd by hub.store.state.select { st -> shownCwd(st).orEmpty() }

    suspend fun fetch(paths: List<String>) = coroutineScope {
        for (p in paths.filter { loading[it] != true }) launch {
            loading[p] = true
            try {
                runCatching { hub.readDir(p) }
                    .onSuccess { dirs[p] = it; error = "" }
                    .onFailure { if (it !is CancellationException && p.isEmpty()) error = it.message ?: "Could not list the files" }
            } finally { loading[p] = false }
        }
    }
    LaunchedEffect(missing.joinToString("\n"), chat) { fetch(missing) }
    LaunchedEffect(refresh) { if (refresh > 0) fetch(dirs.keys.toList()) }

    val o = open
    if (o != null) { FileScreen(hub, o, onBack = { open = null }); return }
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Files", onBack) {
            MoreButton { close ->
                MenuItem(if (showHidden) "Hide ignored files" else "Show ignored files", if (showHidden) "eye" else "eye-closed", { close(); showHidden = !showHidden })
                MenuItem("Refresh Explorer", "refresh", { close(); refresh++ })
                MenuItem("Collapse Folders", "collapse-all", { close(); expanded = emptyList() })
            }
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                if (error.isNotEmpty()) item { ErrorHint(error) }
                else if (dirs[""] == null) item { Hint("Loading…") }
                else if (rows.isEmpty()) item { EmptyState("No files", icon = "files", small = false) }
                item { Spacer(Modifier.padding(top = Tokens.sp4)) }
                lazyGroup(rows, key = { it.path }) { r ->
                    val isOpen = r.dir && r.path in expanded
                    Box {
                        ListRow(
                            r.name,
                            modifier = Modifier.padding(start = Tokens.sp6 * minOf(r.depth, 6)),
                            muted = r.hidden,
                            leading = {
                                AvIcon(if (!r.dir) "file" else if (isOpen) "folder-opened" else "folder", null, Tokens.iconMd, tint = av.fgMuted)
                            },
                            onClick = {
                                if (r.dir) expanded = if (isOpen) expanded - r.path else expanded + r.path
                                else open = r.path
                            },
                            onLongClick = { copying = r.path },
                        )
                        Menu(copying == r.path, { copying = null }) { CopyPathItems(hub, r.path, cwd) { copying = null } }
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}

// web/src/workspace/CopyPathItems.tsx: the Copy path, Copy relative path and Copy name items of a menu.
@Composable
fun CopyPathItems(hub: Hub, path: String, cwd: String, close: () -> Unit) {
    val clip = LocalClipboardManager.current
    val copies = pathCopies(path, cwd)
    fun copy(text: String, done: String) { close(); clip.setText(AnnotatedString(text)); hub.notice.value = done }
    MenuItem("Copy path", "copy", { copy(copies.absolute, "Path copied") })
    copies.relative?.let { MenuItem("Copy relative path", "copy", { copy(it, "Relative path copied") }) }
    MenuItem("Copy name", "copy", { copy(copies.name, "Name copied") })
}

// A file of the chat's folder: syntax highlighted, as a diff against HEAD when it changed, Markdown rendered.
// With a line (a review finding) it opens as plain file text scrolled to that line.
@Composable
fun FileScreen(hub: Hub, path: String, onBack: () -> Unit, diffFirst: Boolean = true, line: Int? = null) {
    BackHandler(onBack = onBack)
    val (load, reload) = rememberLoad(path, hub.pageChat) { hub.readFile(path) }
    val file = load.data
    LaunchedEffect(hub, path) { hub.fileChanged.collect { if (it == path) reload() } }
    var mode by rememberSaveable(path, line) { mutableStateOf(if (diffFirst && line == null) "diff" else "file") }
    var preview by rememberSaveable(path, line) { mutableStateOf(line == null) }
    var wrap by rememberSaveable { mutableStateOf(false) }
    var changes by rememberSaveable { mutableStateOf(true) }
    val canDiff = file != null && file.original.isNotEmpty() && file.original != file.content
    val isDoc = isMarkdown(path)
    val showDoc = preview && isDoc
    val diff = canDiff && mode == "diff" && !showDoc
    val docEdit = remember(path) { DocEditState() }

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, path.substringAfterLast('/'), onBack, sub = parentOf(path).ifEmpty { pageFolder(hub) }) {
            MoreButton { close ->
                if (isDoc) MenuItem("Rendered document", "open-preview", { close(); preview = !showDoc }, checked = showDoc)
                if (canDiff) MenuItem("Change against the last commit", "diff", { close(); preview = false; mode = if (diff) "file" else "diff" }, checked = diff)
                if (diff) MenuItem("Changes only", "fold", { close(); changes = !changes }, checked = changes)
                if (!showDoc) MenuItem("Word wrap", "word-wrap", { close(); wrap = !wrap }, checked = wrap)
                MenuItem("Reload", "refresh", { close(); reload() })
            }
        }
        Box(Modifier.fillMaxSize()) {
            when {
                file == null && load.error.isNotEmpty() -> ErrorHint(load.error)
                file == null -> Hint("Loading…")
                file.error != null -> EmptyState(fileError(file.error))
                file.image -> Column(Modifier.padding(Tokens.sp8)) { ChatImage(hub, hub.pageChat, path) }
                file.binary -> EmptyState("Binary file")
                showDoc -> {
                    val tasks = remember(path, file.content) { if (isSpecPath(path)) specTasks(file.content) else emptyList() }
                    val blocks = remember(file.content) { docBlocks(file.content) }
                    LazyColumn(Modifier.fillMaxSize()) {
                        if (tasks.isNotEmpty()) item { SpecTasks(hub, path, tasks) }
                        item { Spacer(Modifier.padding(top = Tokens.sp4)) }
                        docBlockItems(hub, path, file.content, blocks, docEdit, reload)
                        item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
                    }
                    DocAskSheet(hub, path, docEdit)
                }
                diff -> DiffLinesView(remember(file, changes) { fileDiff(file.original, file.content).let { if (changes) changesOnly(it) else it } }, langOf(path), wrap)
                else -> CodeView(file.content, langOf(path), wrap, line)
            }
        }
    }
}

// The checkbox lines of a spec file: progress and a Start per open task, sent to the chat.
@Composable
private fun SpecTasks(hub: Hub, path: String, tasks: List<SpecTask>) {
    SectionHeader("Tasks", specProgress(tasks), action = if (tasks.any { !it.done }) ({
        Button("Build all", { hub.track("action:buildAll"); hub.askChat("/build $path") }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !hub.readOnly)
    }) else null)
    Group {
        tasks.forEachIndexed { i, t ->
            if (i > 0) Hairline()
            ListRow(t.text, strike = t.done, muted = t.done, trailing = if (t.done) null else if (t.doing) {
                { Badge("In progress", BadgeTone.Running) }
            } else {
                { Button("Start", { hub.track("action:startTask"); hub.askChat(startTaskPrompt(t, path)) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !hub.readOnly) }
            })
        }
    }
}

private const val HIGHLIGHT_LIMIT = 400_000
private const val FLASH_MS = 1600L

@Composable
fun CodeView(text: String, lang: Lang, wrap: Boolean, line: Int? = null) {
    val lines = remember(text) { text.split('\n') }
    val spans by androidx.compose.runtime.produceState<List<List<SynSpan>>?>(null, text, lang) {
        value = if (text.length > HIGHLIGHT_LIMIT) null else withContext(Dispatchers.Default) { highlight(text, lang) }
    }
    val scroll = rememberScrollState()
    val target = findingScroll(line ?: 0, lines.size)
    val list = rememberLazyListState(initialFirstVisibleItemIndex = target ?: 0)
    var flash by remember(line) { mutableStateOf(target) }
    LaunchedEffect(line) { delay(FLASH_MS); flash = null }
    LazyColumn(Modifier.fillMaxSize().padding(vertical = Tokens.sp4), list) {
        itemsIndexed(lines, key = { i, _ -> i }, contentType = { _, _ -> "line" }) { i, l ->
            Box(Modifier.background(if (i == flash) av.accentSoft else Color.Transparent)) {
                CodeLine("${i + 1}", spans?.getOrNull(i)?.let { highlighted(l, it) } ?: AnnotatedString(l), wrap = wrap, scroll = scroll)
            }
        }
    }
}

@Composable
fun DiffLinesView(lines: List<DiffLine>, lang: Lang, wrap: Boolean) {
    val scroll = rememberScrollState()
    if (lines.isEmpty()) { EmptyState("No changes"); return }
    LazyColumn(Modifier.fillMaxSize().padding(vertical = Tokens.sp4)) {
        itemsIndexed(lines, key = { i, _ -> i }, contentType = { _, _ -> "line" }) { _, l -> DiffCodeLine(l, lang, wrap, scroll) }
    }
}

// A diff with line numbers in the gutter; a long press on a line asks for a comment on it.
@Composable
fun NumberedDiffView(rows: List<DiffRow>, lang: Lang, wrap: Boolean, onComment: (DiffRow) -> Unit) {
    val scroll = rememberScrollState()
    val haptic = LocalHapticFeedback.current
    if (rows.isEmpty()) { EmptyState("No changes"); return }
    val digits = (rows.maxOfOrNull { it.no } ?: 0).toString().length
    LazyColumn(Modifier.fillMaxSize().padding(vertical = Tokens.sp4)) {
        itemsIndexed(rows, key = { i, _ -> i }, contentType = { _, _ -> "row" }) { _, r ->
            val long = if (r.line.mark == '@') null else { { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onComment(r) } }
            DiffCodeLine(r.line, lang, wrap, scroll, onLongClick = long, number = if (r.line.mark == '@') "" else "${r.no.toString().padStart(digits)} ${r.line.mark}")
        }
    }
}

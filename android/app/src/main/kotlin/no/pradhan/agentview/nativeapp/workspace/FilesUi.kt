package no.pradhan.agentview.nativeapp.workspace

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.app.shownFeature
import no.pradhan.agentview.nativeapp.chat.ChatImage
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalSheet
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.track
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.read
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

// Files (web/src/workspace/Explorer.tsx and CodePane.tsx): the repo tree of the chat's folder and a file view.
@Composable
fun FilesScreen(hub: Hub, onBack: () -> Unit) {
    val st by hub.store.state.collectAsState()
    val chat = st.shownId
    var open by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    val dirs = remember(chat) { mutableStateMapOf<String, List<DirEntry>>() }
    var expanded by rememberSaveable(chat) { mutableStateOf(listOf<String>()) }
    var showHidden by rememberSaveable { mutableStateOf(false) }
    var error by remember(chat) { mutableStateOf("") }
    val (rows, missing) = treeRows(dirs, expanded.toSet(), showHidden)
    val loading = remember(chat) { mutableStateMapOf<String, Boolean>() }
    var refresh by remember { mutableStateOf(0) }

    suspend fun fetch(paths: List<String>) = coroutineScope {
        for (p in paths.filter { loading[it] != true }) launch {
            loading[p] = true
            try {
                runCatching { parseDir(hub.read("/api/dir?path=${enc(p)}")) }
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
                    ListRow(
                        r.name,
                        modifier = Modifier.padding(start = Tokens.sp6 * minOf(r.depth, 6)),
                        lines = 1,
                        muted = r.hidden,
                        leading = {
                            AvIcon(if (!r.dir) "file" else if (isOpen) "folder-opened" else "folder", null, Tokens.iconMd, tint = av.fgMuted)
                        },
                        onClick = {
                            if (r.dir) expanded = if (isOpen) expanded - r.path else expanded + r.path
                            else open = r.path
                        },
                    )
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}

// A file of the chat's folder: syntax highlighted, as a diff against HEAD when it changed, Markdown rendered.
@Composable
fun FileScreen(hub: Hub, path: String, onBack: () -> Unit, diffFirst: Boolean = true) {
    BackHandler(onBack = onBack)
    val (load, reload) = rememberLoad(path, hub.pageChat) { parseFile(hub.read("/api/file?path=${enc(path)}")) }
    val file = load.data
    LaunchedEffect(hub, path) { hub.fileChanged.collect { if (it == path) reload() } }
    var mode by rememberSaveable(path) { mutableStateOf(if (diffFirst) "diff" else "file") }
    var preview by rememberSaveable(path) { mutableStateOf(true) }
    var wrap by rememberSaveable { mutableStateOf(false) }
    var changes by rememberSaveable { mutableStateOf(true) }
    val canDiff = file != null && file.original.isNotEmpty() && file.original != file.content
    val isDoc = isMarkdown(path)
    val hidden by hub.hiddenFeatures.collectAsState()
    val showDoc = preview && isDoc
    val diff = canDiff && mode == "diff" && !showDoc

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, path.substringAfterLast('/'), onBack, sub = parentOf(path).ifEmpty { pageFolder(hub) }) {
            MoreButton { close ->
                if (isDoc) MenuItem("Rendered document", "open-preview", { close(); preview = !showDoc }, checked = showDoc)
                if (isDoc && shownFeature("action:runAsGoal", hidden)) MenuItem("Run as goal\u2026", "target", { close(); hub.track("action:runAsGoal"); hub.goalSheet.value = GoalSheet.Start(plan = path) })
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
                    LazyColumn(Modifier.fillMaxSize()) {
                        if (tasks.isNotEmpty()) item { SpecTasks(hub, path, tasks) }
                        item { Markdown(file.content, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp6)) }
                    }
                }
                diff -> DiffLinesView(remember(file, changes) { fileDiff(file.original, file.content).let { if (changes) changesOnly(it) else it } }, langOf(path), wrap)
                else -> CodeView(file.content, langOf(path), wrap)
            }
        }
    }
}

// The checkbox lines of a spec file: progress, Run all (a goal) and a Start per open task, sent to the chat.
@Composable
private fun SpecTasks(hub: Hub, path: String, tasks: List<SpecTask>) {
    val hidden by hub.hiddenFeatures.collectAsState()
    SectionHeader("Tasks", specProgress(tasks)) {
        if (tasks.any { !it.done }) {
            var menu by remember { mutableStateOf(false) }
            val all = shownFeature("action:runAll", hidden)
            val goal = shownFeature("action:runAsGoal", hidden)
            if (all || goal) Box {
                Button("Run", { menu = true }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                Menu(menu, { menu = false }) {
                    if (all) MenuItem("Run all in this chat", "debug-start", { menu = false; hub.track("action:runAll"); hub.askChat(runAllPrompt(path)) }, enabled = !hub.readOnly)
                    if (goal) MenuItem("Run as goal\u2026", "target", { menu = false; hub.track("action:runAsGoal"); hub.goalSheet.value = GoalSheet.Start(plan = path) })
                }
            }
        }
    }
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

@Composable
fun CodeView(text: String, lang: Lang, wrap: Boolean) {
    val lines = remember(text) { text.split('\n') }
    val spans by androidx.compose.runtime.produceState<List<List<SynSpan>>?>(null, text, lang) {
        value = if (text.length > HIGHLIGHT_LIMIT) null else withContext(Dispatchers.Default) { highlight(text, lang) }
    }
    val scroll = rememberScrollState()
    LazyColumn(Modifier.fillMaxSize().padding(vertical = Tokens.sp4)) {
        itemsIndexed(lines, key = { i, _ -> i }, contentType = { _, _ -> "line" }) { i, l ->
            CodeLine("${i + 1}", spans?.getOrNull(i)?.let { highlighted(l, it) } ?: AnnotatedString(l), wrap = wrap, scroll = scroll)
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

package no.pradhan.agentview.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.AnnotatedString
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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

    LaunchedEffect(missing.joinToString("\n"), chat, refresh) {
        val want = if (refresh > 0 && missing.isEmpty()) dirs.keys.toList() else missing
        for (p in want.filter { loading[it] != true }) launch {
            loading[p] = true
            runCatching { parseDir(hub.read("/api/dir?path=${enc(p)}")) }
                .onSuccess { dirs[p] = it; error = "" }
                .onFailure { if (p.isEmpty()) error = it.message ?: "Could not list the files" }
            loading[p] = false
        }
    }

    val o = open
    if (o != null) { FileScreen(hub, o, onBack = { open = null }); return }
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Files", onBack) {
            MoreButton { close ->
                MenuItem(if (showHidden) "Hide ignored files" else "Show ignored files", { close(); showHidden = !showHidden })
                MenuItem("Refresh Explorer", { close(); refresh++ })
                MenuItem("Collapse Folders", { close(); expanded = emptyList() })
            }
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                if (error.isNotEmpty()) item { ErrorHint(error) }
                else if (dirs[""] == null) item { Hint("Loading") }
                else if (rows.isEmpty()) item { EmptyState("No files") }
                item { Spacer(Modifier.padding(top = Tokens.sp4)) }
                if (rows.isNotEmpty()) item {
                    Group {
                        rows.forEachIndexed { i, r ->
                            if (i > 0) Hairline()
                            val isOpen = r.dir && r.path in expanded
                            ListRow(
                                r.name,
                                modifier = Modifier.padding(start = Tokens.sp6 * r.depth),
                                lines = 1,
                                muted = r.hidden,
                                leading = {
                                    if (r.dir) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, Modifier.size(Tokens.icon).rotate(if (isOpen) 90f else 0f), tint = av.fileFolder)
                                    else FileTag(r.name)
                                },
                                onClick = {
                                    if (r.dir) expanded = if (isOpen) expanded - r.path else expanded + r.path
                                    else open = r.path
                                },
                            )
                        }
                    }
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
    var mode by rememberSaveable(path) { mutableStateOf(if (diffFirst) "diff" else "file") }
    var preview by rememberSaveable(path) { mutableStateOf(true) }
    var wrap by rememberSaveable { mutableStateOf(false) }
    var changes by rememberSaveable { mutableStateOf(true) }
    val canDiff = file != null && file.original.isNotEmpty() && file.original != file.content
    val isDoc = isMarkdown(path)
    val showDoc = preview && isDoc
    val diff = canDiff && mode == "diff" && !showDoc

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, path.substringAfterLast('/'), onBack, sub = parentOf(path).ifEmpty { pageFolder(hub) }) {
            MoreButton { close ->
                if (isDoc) MenuItem("Rendered document", { close(); preview = !showDoc }, checked = showDoc)
                if (canDiff) MenuItem("Change against the last commit", { close(); preview = false; mode = if (diff) "file" else "diff" }, checked = diff)
                if (diff) MenuItem("Changes only", { close(); changes = !changes }, checked = changes)
                if (!showDoc) MenuItem("Word wrap", { close(); wrap = !wrap }, checked = wrap)
                MenuItem("Reload", { close(); reload() })
            }
        }
        Box(Modifier.fillMaxSize()) {
            when {
                file == null && load.error.isNotEmpty() -> ErrorHint(load.error)
                file == null -> Hint("Loading")
                file.error != null -> EmptyState(fileError(file.error))
                file.image -> Column(Modifier.padding(Tokens.sp8)) { ChatImage(hub, hub.pageChat, path) }
                file.binary -> EmptyState("Binary file")
                showDoc -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = Tokens.listPad)) { item { Markdown(file.content, Modifier.padding(vertical = Tokens.sp6)) } }
                diff -> DiffLinesView(remember(file, changes) { fileDiff(file.original, file.content).let { if (changes) changesOnly(it) else it } }, langOf(path), wrap)
                else -> CodeView(file.content, langOf(path), wrap)
            }
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
        itemsIndexed(lines) { i, l ->
            CodeLine("${i + 1}", spans?.getOrNull(i)?.let { highlighted(l, it) } ?: AnnotatedString(l), wrap = wrap, scroll = scroll)
        }
    }
}

@Composable
fun DiffLinesView(lines: List<DiffLine>, lang: Lang, wrap: Boolean) {
    val scroll = rememberScrollState()
    if (lines.isEmpty()) { EmptyState("No changes"); return }
    LazyColumn(Modifier.fillMaxSize().padding(vertical = Tokens.sp4)) {
        items(lines) { l ->
            val text = if (l.mark == '@') AnnotatedString(l.text) else highlighted(l.text, remember(l) { highlightLine(l.text, lang).first })
            CodeLine(if (l.mark == '@') "" else l.mark.toString(), text, l.mark, wrap, scroll)
        }
    }
}

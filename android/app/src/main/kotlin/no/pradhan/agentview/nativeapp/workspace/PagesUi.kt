package no.pradhan.agentview.nativeapp.workspace

import no.pradhan.agentview.nativeapp.ui.DiffLine
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import androidx.compose.runtime.produceState

// The folder the workspace pages act on, from the chat on screen.
@Composable
fun pageFolder(hub: Hub): String = pageRepo(hub).ifEmpty { "Last viewed chat" }

// The repo name of the chat the page belongs to, empty when there is none.
@Composable
fun pageRepo(hub: Hub): String {
    val cwd by hub.store.state.select { st -> st.session?.cwd?.ifEmpty { null } ?: st.live.firstOrNull { it.id == st.shownId }?.cwd }
    return cwd?.substringAfterLast('/').orEmpty()
}

@Composable
fun WorkspaceHeader(hub: Hub, title: String, onBack: (() -> Unit)?, sub: String? = null, actions: @Composable RowScope.() -> Unit = {}) {
    val folder = pageFolder(hub)
    PageHeader(title, onBack, subtitle = { Text(sub ?: folder, maxLines = 1, overflow = TextOverflow.Ellipsis) }, actions = actions)
}

// A page body on the grouped background.
@Composable
fun PageBody(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(av.groupPage)) { content() }
}

@Composable
fun Hint(text: String, color: Color = av.fgMuted) {
    Text(text, Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), style = Type.subheadline, color = color)
}

@Composable
fun ErrorHint(text: String) { if (text.isNotEmpty()) Hint(text, av.err) }

@Composable
fun openLink(): (String) -> Unit {
    val uri = LocalUriHandler.current
    return { url -> runCatching { uri.openUri(url) } }
}

@Composable
fun Counts(add: Int, del: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        Text("+$add", style = Type.footnote, color = av.diffAdd)
        Text("-$del", style = Type.footnote, color = av.diffDel)
    }
}

@Composable
fun FileTag(name: String, dir: Boolean = false) {
    val c = av
    val color = when (if (dir) FileHue.Folder else fileHue(name)) {
        FileHue.Blue -> c.fileBlue; FileHue.Yellow -> c.fileYellow; FileHue.Purple -> c.filePurple; FileHue.Orange -> c.fileOrange
        FileHue.Green -> c.fileGreen; FileHue.Red -> c.fileRed; FileHue.Pink -> c.filePink; FileHue.Cyan -> c.fileCyan
        FileHue.Gray -> c.fileGray; FileHue.Folder -> c.fileFolder
    }
    Box(Modifier.width(Tokens.leadWidth * 2), contentAlignment = Alignment.CenterStart) {
        Text(fileTag(name), style = Mono.copy(fontSize = Tokens.fsCaption), color = color, maxLines = 1, softWrap = false)
    }
}

@Composable
fun synColor(s: Syn): Color = when (s) {
    Syn.Keyword -> av.synKeyword
    Syn.Str -> av.synString
    Syn.Num -> av.synNumber
    Syn.Comment -> av.synComment
    Syn.Type -> av.synType
    Syn.Property -> av.synProperty
}

@Composable
fun highlighted(line: String, spans: List<SynSpan>): AnnotatedString {
    val colors = Syn.entries.associateWith { synColor(it) }
    return buildAnnotatedString {
        append(line)
        for (s in spans) if (s.end <= line.length) addStyle(SpanStyle(color = colors.getValue(s.syn)), s.start, s.end)
    }
}

// One line of code or diff: a gutter with the line number or mark, then the text on its diff tint.
@Composable
fun CodeLine(number: String, text: AnnotatedString, mark: Char = ' ', wrap: Boolean, scroll: ScrollState, gutter: Dp = Tokens.sp24, onLongClick: (() -> Unit)? = null) {
    val c = av
    val bg = when (mark) { '+' -> c.diffAddSoft; '-' -> c.diffDelSoft; '@' -> c.hover; else -> Color.Transparent }
    Row(Modifier.fillMaxWidth().background(bg).then(if (onLongClick != null) Modifier.combinedClickable(onClick = {}, onLongClick = onLongClick) else Modifier).then(if (wrap) Modifier else Modifier.horizontalScroll(scroll))) {
        Text(number, Modifier.widthIn(min = gutter).padding(start = Tokens.sp4, end = Tokens.sp4), style = Mono, color = c.fgMuted, maxLines = 1)
        Text(text, style = Mono, color = if (mark == '@') c.fgMuted else c.fg, softWrap = wrap)
    }
}

// One diff line as a CodeLine, its mark in the gutter and its text highlighted for `lang`.
@Composable
fun DiffCodeLine(l: DiffLine, lang: Lang, wrap: Boolean, scroll: ScrollState, gutter: Dp = Tokens.sp24, onLongClick: (() -> Unit)? = null, number: String? = null) {
    val text = if (l.mark == '@') AnnotatedString(l.text) else highlighted(l.text, remember(l, lang) { highlightLine(l.text, lang).first })
    CodeLine(number ?: if (l.mark == '@') "" else l.mark.toString(), text, l.mark, wrap, scroll, gutter, onLongClick)
}

private const val PATCH_LINES = 400

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
        lines.take(PATCH_LINES).forEach { l -> DiffCodeLine(l, lang, wrap = false, scroll = scroll) }
        if (lines.size > PATCH_LINES) Hint("${lines.size - PATCH_LINES} more lines")
    }
}

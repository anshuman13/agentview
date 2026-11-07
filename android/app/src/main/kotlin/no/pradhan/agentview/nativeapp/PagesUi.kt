package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import kotlin.coroutines.cancellation.CancellationException

// The state of one page request: the last data, the error of the last try, and whether one is running.
data class Loaded<T>(val data: T? = null, val error: String = "", val busy: Boolean = true)

// Runs `fetch` when a key changes or on refresh, keeping the previous data while it runs.
@Composable
fun <T> rememberLoad(vararg keys: Any?, fetch: suspend () -> T): Pair<Loaded<T>, () -> Unit> {
    var tick by remember { mutableIntStateOf(0) }
    var state by remember(*keys) { mutableStateOf(Loaded<T>()) }
    LaunchedEffect(*keys, tick) {
        state = state.copy(error = "", busy = true)
        state = try {
            Loaded(fetch(), "", false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Loaded(state.data, e.message?.ifEmpty { null } ?: "Request failed", false)
        }
    }
    return state to { tick++ }
}

// The folder the workspace pages act on, from the chat on screen.
@Composable
fun pageFolder(hub: Hub): String {
    val st by hub.store.state.collectAsState()
    val cwd = st.session?.cwd?.ifEmpty { null } ?: st.live.firstOrNull { it.id == st.shownId }?.cwd
    return cwd?.substringAfterLast('/') ?: "Last viewed chat"
}

@Composable
fun WorkspaceHeader(hub: Hub, title: String, onBack: (() -> Unit)?, sub: String? = null, actions: @Composable RowScope.() -> Unit = {}) {
    val folder = pageFolder(hub)
    PageHeader(title, onBack, large = false, subtitle = { Text(sub ?: folder, style = Type.footnote, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) }, actions = actions)
}

// A page body on the grouped background.
@Composable
fun PageBody(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(av.groupPage)) { content() }
}

@Composable
fun Hint(text: String, color: Color = av.fgMuted, mono: Boolean = false) {
    Text(text, Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), style = if (mono) Mono else Type.subheadline, color = color)
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
    Text(fileTag(name), style = Mono.copy(fontSize = Tokens.fsCaption2), color = color, maxLines = 1, softWrap = false, modifier = Modifier.wrapContentWidth(unbounded = true))
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
fun CodeLine(number: String, text: AnnotatedString, mark: Char = ' ', wrap: Boolean, scroll: ScrollState, gutter: Dp = Tokens.sp24) {
    val c = av
    val bg = when (mark) { '+' -> c.diffAddSoft; '-' -> c.diffDelSoft; '@' -> c.hover; else -> Color.Transparent }
    Row(Modifier.fillMaxWidth().background(bg).then(if (wrap) Modifier else Modifier.horizontalScroll(scroll))) {
        Text(number, Modifier.widthIn(min = gutter).padding(start = Tokens.sp4, end = Tokens.sp4), style = Mono, color = c.fgFaint, maxLines = 1)
        Text(text, style = Mono, color = if (mark == '@') c.fgMuted else c.fg, softWrap = wrap)
    }
}

// One diff line as a CodeLine, its mark in the gutter and its text highlighted for `lang`.
@Composable
fun DiffCodeLine(l: DiffLine, lang: Lang, wrap: Boolean, scroll: ScrollState, gutter: Dp = Tokens.sp24) {
    val text = if (l.mark == '@') AnnotatedString(l.text) else highlighted(l.text, remember(l, lang) { highlightLine(l.text, lang).first })
    CodeLine(if (l.mark == '@') "" else l.mark.toString(), text, l.mark, wrap, scroll, gutter)
}

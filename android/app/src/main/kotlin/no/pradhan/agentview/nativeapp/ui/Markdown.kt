package no.pradhan.agentview.nativeapp.ui

import android.util.LruCache
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

// Opens a file path named in inline code or a link, at its line; set by a chat, so file paths elsewhere stay plain.
val LocalOpenFile = staticCompositionLocalOf<((String, Int?) -> Unit)?> { null }

// Types a one-line shell command into the chat's terminal; set by a chat outside read-only mode, so code blocks elsewhere offer only Copy.
val LocalRunCommand = staticCompositionLocalOf<((String) -> Unit)?> { null }

// Shows a snack naming what was done, such as "Code copied"; set once by the app shell.
val LocalNotice = staticCompositionLocalOf<((String) -> Unit)?> { null }

@Composable
fun inlineText(inlines: List<Inline>): AnnotatedString {
    val c = av
    val code = SpanStyle(fontFamily = MonoFont, fontSize = Tokens.fsSubheadline, background = c.hover)
    val link = TextLinkStyles(SpanStyle(color = c.link))
    val open = LocalOpenFile.current
    return remember(inlines, c, open) {
        fun fileLink(target: String, isLink: Boolean = false) = open?.let { o -> filePath(target, isLink)?.let { f -> LinkAnnotation.Clickable(target, link) { o(f.path, f.line) } } }
        buildAnnotatedString {
            fun walk(list: List<Inline>) {
                for (i in list) when (i) {
                    is Inline.Text -> append(i.text)
                    is Inline.Code -> fileLink(i.text)?.let { withLink(it) { withStyle(code) { append(i.text) } } } ?: withStyle(code) { append(i.text) }
                    is Inline.Strong -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { walk(i.children) }
                    is Inline.Emph -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { walk(i.children) }
                    is Inline.Strike -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { walk(i.children) }
                    is Inline.Link -> withLink(fileLink(decodedTarget(i.url), true) ?: LinkAnnotation.Url(i.url, link)) { walk(i.children) }
                    Inline.Break -> append('\n')
                }
            }
            walk(inlines)
        }
    }
}

const val MARKDOWN_STREAM_MS = 100L
private val parsed = LruCache<String, List<MdBlock>>(64)

// Parses off the main thread. While `streaming` the text is re-parsed at most every MARKDOWN_STREAM_MS; a finished message is parsed once.
// `fresh` marks a message that arrived while its chat was showing: all its blocks count as new, so its opening words fade.
@Composable
fun Markdown(text: String, modifier: Modifier = Modifier, streaming: Boolean = false, reading: Boolean = false, fresh: Boolean = false) {
    val latest by rememberUpdatedState(text to streaming)
    val blocks by produceState(parsed.get(text)) {
        var last = 0L
        snapshotFlow { latest }.collect { (_, live) ->
            if (live) delay(last + MARKDOWN_STREAM_MS - System.currentTimeMillis())
            val (t, still) = latest
            last = System.currentTimeMillis()
            value = parsed.get(t) ?: withContext(Dispatchers.Default) { parseMarkdown(t) }.also { if (!still) parsed.put(t, it) }
        }
    }
    val fade = streaming && !motionOff()
    blocks?.let { CompositionLocalProvider(LocalStreamFade provides fade, LocalFreshBlock provides fresh) { MdBlocks(it, modifier, reading) } }
}

@Composable
private fun MdBlocks(blocks: List<MdBlock>, modifier: Modifier = Modifier, reading: Boolean = false) {
    val parentFresh = LocalFreshBlock.current
    val seen = remember { blocks.size }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        blocks.forEachIndexed { i, b ->
            CompositionLocalProvider(LocalFreshBlock provides (parentFresh || i >= seen)) { MdBlockView(b, reading) }
        }
    }
}

@Composable
private fun MdBlockView(b: MdBlock, reading: Boolean) {
    val body = (if (reading) Type.reading else Type.body).copy(color = av.fg)
    when (b) {
        is MdBlock.Para -> Text(fadedText(inlineText(b.inlines), body.color), style = body)
        is MdBlock.Heading -> Text(
            fadedText(inlineText(b.inlines), body.color),
            style = if (reading) body.copy(fontWeight = FontWeight.Bold, fontSize = if (b.level <= 1) body.fontSize * 1.25f else body.fontSize)
                else (if (b.level <= 1) Type.headline.copy(fontSize = Tokens.fsXl) else Type.headline).copy(color = av.fg),
            modifier = Modifier.padding(top = Tokens.sp4),
        )
        is MdBlock.Code -> CodeBlock(b.text, b.lang)
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(Tokens.bar).fillMaxHeight().background(av.borderStrong))
            MdBlocks(b.blocks, Modifier.padding(start = Tokens.sp4), reading)
        }
        is MdBlock.Items -> Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            b.items.forEachIndexed { n, item ->
                Row {
                    Text(if (b.ordered) "${b.start + n}." else "•", style = body, color = av.fgMuted, modifier = Modifier.width(Tokens.leadWidth).padding(start = Tokens.sp2))
                    MdBlocks(item, Modifier.weight(1f), reading)
                }
            }
        }
        MdBlock.Rule -> HorizontalDivider(color = av.border, thickness = Tokens.hairline)
        is MdBlock.Table -> TableView(b)
    }
}

@Composable
fun CodeBlock(text: String, lang: String = "", modifier: Modifier = Modifier) {
    val clip = LocalClipboardManager.current
    val run = LocalRunCommand.current
    val notice = LocalNotice.current
    val cmd = run?.let { shellLine(lang, text) }
    val shape = RoundedCornerShape(Tokens.shapeLg)
    Column(modifier.fillMaxWidth().clip(shape).border(BorderStroke(Tokens.hairline, av.border), shape)) {
        Row(Modifier.fillMaxWidth().padding(start = Tokens.sp6, end = Tokens.sp2), verticalAlignment = Alignment.CenterVertically) {
            Text(lang, style = Type.caption, color = av.fgMuted, modifier = Modifier.weight(1f))
            if (run != null && cmd != null) IconBtn("terminal", "Run in terminal", { run(cmd) })
            IconBtn("copy", "Copy code", { clip.setText(AnnotatedString(text)); notice?.invoke("Code copied") })
        }
        Text(
            text,
            style = Mono,
            color = av.fg,
            softWrap = false,
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(Tokens.sp6),
        )
    }
}

@Composable
private fun TableView(t: MdBlock.Table) {
    val cols = maxOf(t.header.size, t.rows.maxOfOrNull { it.size } ?: 0)
    Column(Modifier.horizontalScroll(rememberScrollState())) {
        val rows = (if (t.header.isEmpty()) emptyList() else listOf(t.header)) + t.rows
        rows.forEachIndexed { r, row ->
            Row {
                for (c in 0 until cols) {
                    Text(
                        inlineText(row.getOrElse(c) { emptyList() }),
                        style = Type.subheadline.copy(color = av.fg),
                        fontWeight = if (r == 0 && t.header.isNotEmpty()) FontWeight.SemiBold else null,
                        modifier = Modifier.width(Tokens.tableCell).padding(top = Tokens.sp4, bottom = Tokens.sp4, end = Tokens.sp6),
                    )
                }
            }
            HorizontalDivider(Modifier.width(Tokens.tableCell * cols), color = if (r == 0 && t.header.isNotEmpty()) av.borderStrong else av.border, thickness = Tokens.hairline)
        }
    }
}

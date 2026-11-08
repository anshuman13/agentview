package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle

@Composable
fun inlineText(inlines: List<Inline>): AnnotatedString {
    val c = av
    val code = SpanStyle(fontFamily = FontFamily.Monospace, fontSize = Tokens.fsSubheadline, background = c.hover)
    val link = TextLinkStyles(SpanStyle(color = c.link))
    return remember(inlines, c) {
        buildAnnotatedString {
            fun walk(list: List<Inline>) {
                for (i in list) when (i) {
                    is Inline.Text -> append(i.text)
                    is Inline.Code -> withStyle(code) { append(i.text) }
                    is Inline.Strong -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { walk(i.children) }
                    is Inline.Emph -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { walk(i.children) }
                    is Inline.Strike -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { walk(i.children) }
                    is Inline.Link -> withLink(LinkAnnotation.Url(i.url, link)) { walk(i.children) }
                    Inline.Break -> append('\n')
                }
            }
            walk(inlines)
        }
    }
}

@Composable
fun Markdown(text: String, modifier: Modifier = Modifier) {
    val blocks = remember(text) { parseMarkdown(text) }
    MdBlocks(blocks, modifier)
}

@Composable
private fun MdBlocks(blocks: List<MdBlock>, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        for (b in blocks) MdBlockView(b)
    }
}

@Composable
private fun MdBlockView(b: MdBlock) {
    val body = Type.body.copy(color = av.fg)
    when (b) {
        is MdBlock.Para -> Text(inlineText(b.inlines), style = body)
        is MdBlock.Heading -> Text(
            inlineText(b.inlines),
            style = (if (b.level <= 1) Type.headline.copy(fontSize = Tokens.fsXl) else Type.headline).copy(color = av.fg),
            modifier = Modifier.padding(top = Tokens.sp4),
        )
        is MdBlock.Code -> CodeBlock(b.text, b.lang)
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(Tokens.bar).fillMaxHeight().background(av.borderStrong))
            MdBlocks(b.blocks, Modifier.padding(start = Tokens.sp4))
        }
        is MdBlock.Items -> Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            b.items.forEachIndexed { n, item ->
                Row {
                    Text(if (b.ordered) "${b.start + n}." else "•", style = body, color = av.fgMuted, modifier = Modifier.width(Tokens.leadWidth).padding(start = Tokens.sp2))
                    MdBlocks(item, Modifier.weight(1f))
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
    Column(modifier.well(av)) {
        Row(Modifier.fillMaxWidth().padding(start = Tokens.sp5, end = Tokens.sp2), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(lang, style = Type.footnote, color = av.fgMuted)
            IconBtn("copy", "Copy code", { clip.setText(AnnotatedString(text)) })
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
                        modifier = Modifier.width(Tokens.tableCell).border(BorderStroke(Tokens.hairline, av.border)).padding(Tokens.sp4),
                    )
                }
            }
        }
    }
}

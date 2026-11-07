package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun inlineText(inlines: List<Inline>): AnnotatedString {
    val c = av
    val code = SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, background = c.surface)
    val link = TextLinkStyles(SpanStyle(color = c.accentText))
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
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Sp.s4)) {
        for (b in blocks) MdBlockView(b)
    }
}

@Composable
private fun MdBlockView(b: MdBlock) {
    val body = MaterialTheme.typography.bodyMedium
    when (b) {
        is MdBlock.Para -> Text(inlineText(b.inlines), style = body)
        is MdBlock.Heading -> Text(
            inlineText(b.inlines),
            style = if (b.level <= 1) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleSmall,
            modifier = Modifier.padding(top = Sp.s3),
        )
        is MdBlock.Code -> CodeBlock(b.text, b.lang)
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(av.border))
            MdBlocks(b.blocks, Modifier.padding(start = Sp.s4))
        }
        is MdBlock.Items -> Column(verticalArrangement = Arrangement.spacedBy(Sp.s1)) {
            b.items.forEachIndexed { n, item ->
                Row {
                    Text(if (b.ordered) "${b.start + n}." else "•", style = body, color = av.fgMuted, modifier = Modifier.width(24.dp).padding(start = Sp.s2))
                    MdBlocks(item, Modifier.weight(1f))
                }
            }
        }
        MdBlock.Rule -> HorizontalDivider(color = av.border)
        is MdBlock.Table -> TableView(b)
    }
}

@Composable
fun CodeBlock(text: String, lang: String = "", modifier: Modifier = Modifier) {
    val clip = LocalClipboardManager.current
    Column(modifier.fillMaxWidth().background(av.surface, RoundedCornerShape(4.dp)).border(BorderStroke(1.dp, av.border), RoundedCornerShape(4.dp))) {
        Row(Modifier.fillMaxWidth().padding(start = Sp.s5, end = Sp.s5, top = Sp.s2), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(lang, style = MaterialTheme.typography.labelSmall, color = av.fgFaint)
            Text("Copy", style = MaterialTheme.typography.labelSmall, color = av.accentText, modifier = Modifier.clickable { clip.setText(AnnotatedString(text)) })
        }
        Text(
            text,
            fontFamily = FontFamily.Monospace,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            softWrap = false,
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Sp.s5, vertical = Sp.s4),
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
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = if (r == 0 && t.header.isNotEmpty()) FontWeight.SemiBold else null,
                        modifier = Modifier.width(140.dp).border(BorderStroke(0.5.dp, av.border)).padding(horizontal = Sp.s4, vertical = Sp.s2),
                    )
                }
            }
        }
    }
}

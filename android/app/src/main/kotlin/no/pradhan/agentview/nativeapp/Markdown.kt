package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

sealed interface Block {
    data class Para(val text: String) : Block
    data class Heading(val text: String) : Block
    data class Item(val marker: String, val text: String) : Block
    data class Code(val text: String) : Block
}

// Fenced code, headings, bullet and numbered lists, paragraphs.
fun parseBlocks(src: String): List<Block> {
    val out = mutableListOf<Block>()
    val para = StringBuilder()
    fun flush() { if (para.isNotEmpty()) { out += Block.Para(para.toString()); para.clear() } }
    val lines = src.split('\n')
    var i = 0
    while (i < lines.size) {
        val l = lines[i]
        val t = l.trimStart()
        when {
            t.startsWith("```") -> {
                flush()
                val code = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith("```")) {
                    if (code.isNotEmpty()) code.append('\n')
                    code.append(lines[i])
                    i++
                }
                out += Block.Code(code.toString())
            }
            l.isBlank() -> flush()
            t.startsWith("#") && t.trimStart('#').startsWith(" ") -> { flush(); out += Block.Heading(t.trimStart('#').trim()) }
            Regex("^[-*+] .*").matches(t) -> { flush(); out += Block.Item("•", t.substring(2)) }
            Regex("^\\d+[.)] .*").matches(t) -> { flush(); val n = t.indexOfFirst { it == '.' || it == ')' }; out += Block.Item(t.substring(0, n + 1), t.substring(n + 2)) }
            else -> { if (para.isNotEmpty()) para.append('\n'); para.append(l) }
        }
        i++
    }
    flush()
    return out
}

// Inline `code`, **bold** and *italic*.
fun inline(src: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < src.length) {
        val c = src[i]
        val tick = if (c == '`') src.indexOf('`', i + 1) else -1
        val bold = if (src.startsWith("**", i)) src.indexOf("**", i + 2) else -1
        val em = if (c == '*' && i + 1 < src.length && !src[i + 1].isWhitespace() && !src.startsWith("**", i)) src.indexOf('*', i + 1) else -1
        when {
            tick > i -> {
                withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Color(0x33888888))) { append(src.substring(i + 1, tick)) }
                i = tick + 1
            }
            bold > i + 1 -> {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(src.substring(i + 2, bold)) }
                i = bold + 2
            }
            em > i + 1 -> {
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(src.substring(i + 1, em)) }
                i = em + 1
            }
            else -> { append(c); i++ }
        }
    }
}

@Composable
fun Markdown(text: String, modifier: Modifier = Modifier) {
    val blocks = remember(text) { parseBlocks(text) }
    Column(modifier, verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(6.dp)) {
        for (b in blocks) when (b) {
            is Block.Para -> Text(inline(b.text), style = MaterialTheme.typography.bodyMedium)
            is Block.Heading -> Text(inline(b.text), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            is Block.Item -> androidx.compose.foundation.layout.Row {
                Text(b.marker, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(end = 8.dp, start = 4.dp))
                Text(inline(b.text), style = MaterialTheme.typography.bodyMedium)
            }
            is Block.Code -> Text(
                b.text,
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                softWrap = false,
                modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).horizontalScroll(rememberScrollState()).padding(8.dp),
            )
        }
    }
}

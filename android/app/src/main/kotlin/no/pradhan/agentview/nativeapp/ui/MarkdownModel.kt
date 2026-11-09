package no.pradhan.agentview.nativeapp.ui

import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableBody
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TableHead
import org.commonmark.ext.gfm.tables.TableRow
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.HtmlBlock
import org.commonmark.node.HtmlInline
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.Parser

sealed interface Inline {
    data class Text(val text: String) : Inline
    data class Code(val text: String) : Inline
    data class Strong(val children: List<Inline>) : Inline
    data class Emph(val children: List<Inline>) : Inline
    data class Strike(val children: List<Inline>) : Inline
    data class Link(val url: String, val children: List<Inline>) : Inline
    data object Break : Inline
}

sealed interface MdBlock {
    data class Para(val inlines: List<Inline>) : MdBlock
    data class Heading(val level: Int, val inlines: List<Inline>) : MdBlock
    data class Code(val lang: String, val text: String) : MdBlock
    data class Quote(val blocks: List<MdBlock>) : MdBlock
    data class Items(val ordered: Boolean, val start: Int, val items: List<List<MdBlock>>) : MdBlock
    data object Rule : MdBlock
    data class Table(val header: List<List<Inline>>, val rows: List<List<List<Inline>>>) : MdBlock
}

private val parser: Parser = Parser.builder().extensions(listOf(TablesExtension.create(), StrikethroughExtension.create())).build()

private val SAFE = Regex("^(https?:|mailto:)", RegexOption.IGNORE_CASE)

fun parseMarkdown(src: String): List<MdBlock> = blocks(parser.parse(src))

private fun children(n: Node): List<Node> = generateSequence(n.firstChild) { it.next }.toList()

private fun blocks(parent: Node): List<MdBlock> = children(parent).mapNotNull { block(it) }

private fun block(n: Node): MdBlock? = when (n) {
    is Paragraph -> MdBlock.Para(inlines(n))
    is Heading -> MdBlock.Heading(n.level, inlines(n))
    is FencedCodeBlock -> MdBlock.Code(n.info.orEmpty().trim().substringBefore(' '), n.literal.orEmpty().trimEnd('\n'))
    is IndentedCodeBlock -> MdBlock.Code("", n.literal.orEmpty().trimEnd('\n'))
    is BlockQuote -> MdBlock.Quote(blocks(n))
    is BulletList -> MdBlock.Items(false, 1, children(n).map { blocks(it) })
    is OrderedList -> MdBlock.Items(true, n.markerStartNumber ?: 1, children(n).map { blocks(it) })
    is ThematicBreak -> MdBlock.Rule
    is HtmlBlock -> MdBlock.Para(listOf(Inline.Text(n.literal.orEmpty().trim())))
    is TableBlock -> {
        val head = children(n).filterIsInstance<TableHead>().flatMap { children(it) }.filterIsInstance<TableRow>().firstOrNull()
        val body = children(n).filterIsInstance<TableBody>().flatMap { children(it) }.filterIsInstance<TableRow>()
        fun cells(r: TableRow) = children(r).filterIsInstance<TableCell>().map { inlines(it) }
        MdBlock.Table(head?.let(::cells) ?: emptyList(), body.map(::cells))
    }
    else -> null
}

private fun inlines(parent: Node): List<Inline> = children(parent).flatMap { inline(it) }

private fun inline(n: Node): List<Inline> = when (n) {
    is org.commonmark.node.Text -> listOf(Inline.Text(n.literal))
    is Code -> listOf(Inline.Code(n.literal))
    is Emphasis -> listOf(Inline.Emph(inlines(n)))
    is StrongEmphasis -> listOf(Inline.Strong(inlines(n)))
    is Strikethrough -> listOf(Inline.Strike(inlines(n)))
    is SoftLineBreak -> listOf(Inline.Text(" "))
    is HardLineBreak -> listOf(Inline.Break)
    is HtmlInline -> listOf(Inline.Text(n.literal))
    is Link -> {
        val kids = inlines(n)
        if (SAFE.containsMatchIn(n.destination)) listOf(Inline.Link(n.destination, kids)) else kids
    }
    // A model-written image would load its URL on render, so it shows as a link, as on the web.
    is Image -> {
        val label = inlines(n).ifEmpty { listOf(Inline.Text(n.destination)) }
        if (SAFE.containsMatchIn(n.destination)) listOf(Inline.Link(n.destination, label)) else label
    }
    else -> inlines(n)
}

fun plainText(inlines: List<Inline>): String = inlines.joinToString("") {
    when (it) {
        is Inline.Text -> it.text
        is Inline.Code -> it.text
        is Inline.Strong -> plainText(it.children)
        is Inline.Emph -> plainText(it.children)
        is Inline.Strike -> plainText(it.children)
        is Inline.Link -> plainText(it.children)
        Inline.Break -> "\n"
    }
}

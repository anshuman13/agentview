package no.pradhan.agentview.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownModelTest {
    @Test
    fun parsesBlocks() {
        val b = parseMarkdown("# Title\n\nSome **bold** and `code`.\n\n- a\n- b\n\n1. one\n2. two\n\n```kotlin\nval x = 1\n```\n\n> quote\n\n---")
        assertEquals(
            listOf("Heading", "Para", "Items", "Items", "Code", "Quote", "Rule"),
            b.map { it::class.simpleName },
        )
        val code = b[4] as MdBlock.Code
        assertEquals("kotlin", code.lang)
        assertEquals("val x = 1", code.text)
        assertEquals(false, (b[2] as MdBlock.Items).ordered)
        assertEquals(2, (b[3] as MdBlock.Items).items.size)
    }

    @Test
    fun parsesInlineStyles() {
        val p = parseMarkdown("a *em* **st** ~~gone~~ [site](https://x.dev) `c`").single() as MdBlock.Para
        assertEquals(
            listOf("Text", "Emph", "Text", "Strong", "Text", "Strike", "Text", "Link", "Text", "Code"),
            p.inlines.map { it::class.simpleName },
        )
        assertEquals("a em st gone site c", plainText(p.inlines))
    }

    @Test
    fun parsesTablesWithHeader() {
        val t = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |").single() as MdBlock.Table
        assertEquals(listOf("A", "B"), t.header.map { plainText(it) })
        assertEquals(2, t.rows.size)
        assertEquals("4", plainText(t.rows[1][1]))
    }

    @Test
    fun unsafeLinksAndImagesLoseTheirTarget() {
        val p = parseMarkdown("[x](javascript:alert(1)) ![pic](https://a/b.png) ![local](/etc/passwd)").single() as MdBlock.Para
        val links = p.inlines.filterIsInstance<Inline.Link>()
        assertEquals(listOf("https://a/b.png"), links.map { it.url })
        assertTrue(plainText(p.inlines).contains("local"))
    }

    @Test
    fun unclosedFenceWhileStreamingStillGivesCode() {
        val b = parseMarkdown("text\n\n```\nlet a = 1")
        assertEquals("let a = 1", (b.last() as MdBlock.Code).text)
    }

    @Test
    fun nestedListItemsKeepTheirBlocks() {
        val l = parseMarkdown("- a\n  - b\n- c").single() as MdBlock.Items
        assertEquals(2, l.items.size)
        assertEquals(2, l.items[0].size)
    }
}

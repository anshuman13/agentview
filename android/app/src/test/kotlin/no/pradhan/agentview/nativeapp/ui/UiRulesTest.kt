package no.pradhan.agentview.nativeapp.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class UiRulesTest {
    private val dir = listOf(File("src/main/kotlin"), File("app/src/main/kotlin")).first { it.exists() }

    private fun lines(skip: (File) -> Boolean = { false }) = dir.walkTopDown()
        .filter { it.extension == "kt" && it.name != "Codicons.kt" && it.name != "Tokens.kt" && !skip(it) }
        .flatMap { f -> f.readLines().mapIndexed { i, l -> Triple(f, i, l) } }
        .toList()

    private fun fails(rule: String, bad: List<Triple<File, Int, String>>) =
        assertTrue("$rule: ${bad.map { "${it.first.name}:${it.second + 1}" }}", bad.isEmpty())

    @Test fun loadingTextEndsInEllipsis() {
        val text = Regex("""\bLoading\("([^"]*)"""")
        val all = lines()
        assertTrue(all.count { text.containsMatchIn(it.third) } > 10)
        fails("Loading text without a trailing ellipsis", all.filter { l -> text.findAll(l.third).any { !it.groupValues[1].endsWith("…") } })
    }

    @Test fun pageEmptyStatesHaveAnIcon() {
        fails("EmptyState with small = false and no icon", lines().filter { it.third.contains("EmptyState(") && it.third.contains("small = false") && !it.third.contains("icon =") })
    }

    @Test fun couldNotLoadOffersRetry() {
        fails("Could not load without an action", lines().filter { it.third.contains("EmptyState(\"Could not load") && !it.third.contains("action =") })
        fails("ErrorHint for a load that can be retried", lines().filter { it.third.contains("ErrorHint(\"Could not load") })
    }

    @Test fun pageHeaderHoldsOneIconButton() {
        fails("PageHeader with more than one IconBtn", lines().filter { it.third.contains("PageHeader(") && Regex("""\bIconBtn\(""").findAll(it.third).count() > 1 })
    }

    @Test fun textIsNeverFaint() {
        fails("Text coloured fgFaint", lines().filter { Regex("""\bText\(""").containsMatchIn(it.third) && it.third.contains("color = av.fgFaint") })
    }

    @Test fun textBackgroundsHaveNoAlpha() {
        val faded = Regex("""val (\w+) = .*\.copy\(alpha""")
        val bad = lines().groupBy { it.first }.flatMap { (_, ls) ->
            val names = ls.mapNotNull { faded.find(it.third)?.groupValues?.get(1) }
            ls.filter { l ->
                val bg = l.third.substringAfter("SpanStyle(", "").substringAfter("background = ", "")
                bg.contains(".copy(alpha") || names.any { Regex("""\b$it\b""").containsMatchIn(bg) }
            }
        }
        fails("Text background with .copy(alpha", bad)
    }

    @Test fun everyCopyOutsideUiSaysSo() {
        val all = lines { it.path.contains("/ui/") }.groupBy { it.first }
        val bad = all.flatMap { (_, ls) -> ls.filter { l -> l.third.contains("clip.setText(") && ls.filter { it.second in l.second..l.second + 2 }.none { it.third.contains("opied") } } }
        fails("clip.setText without a copied notice", bad)
    }
}

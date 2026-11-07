package no.pradhan.agentview.nativeapp

import no.pradhan.agentview.tokens.IconGen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class IconsTest {
    @Test fun parsesCsv() {
        assertEquals(listOf("account" to 0xEB99, "clock" to 0xEA82), IconGen.parse(".codicon-account:before { content: \"\\eb99\" }\n.codicon-clock:before { content: \"\\ea82\" }\n"))
    }

    @Test fun everyIconNameUsedInTheAppIsInTheMap() {
        val dir = listOf(File("src/main/kotlin"), File("app/src/main/kotlin")).first { it.exists() }
        val q = "\"([a-z][a-z0-9-]*)\""
        val call = Regex("""(?:\bicon|trailingIcon)\s*=\s*([^\n]{0,80})|\b(?:AvIcon|IconBtn|Fab)\(([^\n]{0,80})|MenuItem\((?:"(?:[^"\\]|\\.)*"|[^,"]+?),\s*((?:if \([^)]*\) )?"[a-z-]+"(?: else "[a-z-]+")?)\s*,""")
        val name = Regex(q)
        val used = dir.walkTopDown().filter { it.extension == "kt" && it.name != "Codicons.kt" && it.name != "Tokens.kt" }.flatMap { f ->
            call.findAll(f.readText()).flatMap { m -> name.findAll(m.groupValues.drop(1).joinToString(" ")).map { f.name to it.groupValues[1] } }
        }.toList()
        assertTrue(used.size > 50)
        val missing = used.filter { it.second !in Codicons.codepoints }
        assertTrue("not in the codicon map: $missing", missing.isEmpty())
    }

    @Test fun sourceIconsExist() {
        listOf("meeting", "slack", "linear", "pr", "doc").forEach { assertTrue(Codicons.codepoints.containsKey(Source(it, "", null).icon)) }
    }

    @Test fun tabIconsExist() {
        Tab.entries.forEach { assertTrue(Codicons.codepoints.containsKey(icon(it))) }
    }
}

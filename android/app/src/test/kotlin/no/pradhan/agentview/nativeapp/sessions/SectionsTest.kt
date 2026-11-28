package no.pradhan.agentview.nativeapp.sessions

import org.junit.Assert.assertEquals
import org.junit.Test

class SectionsTest {
    private fun chat(id: String, section: String? = null, last: Long = 0) = SavedSession(id, "Chat $id", "/r/$id", lastModified = last, section = section)
    private val chats = listOf(chat("a", "Work", 1), chat("b", "Work", 2), chat("c", "Admin"), chat("d"))

    @Test fun countsSections() = assertEquals(listOf("Admin" to 1, "Work" to 2), sectionList(chats))

    @Test fun groupsRowsNewestFirst() {
        val rows = sectionRows(emptyList(), Workspace(saved = chats), "")
        assertEquals(listOf("Admin" to listOf("c"), "Work" to listOf("b", "a")), rows.map { (n, l) -> n to l.map { it.key } })
    }

    @Test fun offersOtherSectionsAndNewName() {
        assertEquals(listOf("Admin"), sectionChoices(chats, "Work", "").first.map { it.first })
        assertEquals("Side work", sectionChoices(chats, null, "  Side  work ").second)
        assertEquals(null, sectionChoices(chats, null, "work").second)
    }
}

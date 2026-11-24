package no.pradhan.agentview.nativeapp.codex

import org.junit.Assert.assertEquals
import org.junit.Test

class MorningLogicTest {
    @Test fun turnsBriefRowsIntoOneLinePerTopic() {
        val rows = parseMorningRows("""[{"section":"tasks","title":"Send invoice","meta":"overdue"},{"section":"meetings","title":"Standup","meta":"09:00-09:30"},{"section":"meetings","title":"Review","meta":"13:00-14:00"},{"section":"plan","title":"Free 7h30","meta":""},{"section":"plan","title":"1 task at risk","meta":""}]""")
        assertEquals(
            listOf(MorningLine("Meetings", "Standup (09:00-09:30) and 1 more"), MorningLine("Time", "Free 7h30, 1 task at risk"), MorningLine("Tasks", "Send invoice (overdue)")),
            morningLines(rows),
        )
        assertEquals(emptyList<MorningRow>(), parseMorningRows("nope"))
    }
}

package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.workspace.isoMillis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MessageSearchTest {
    @Test fun queryStartsAtThreeCharacters() {
        assertNull(messageQuery(" ab "))
        assertEquals("retry", messageQuery(" retry "))
    }

    @Test fun metaNamesChatAuthorAndAge() {
        val now = isoMillis("2026-11-09T12:00:00Z")
        val hits = protocolJson.decodeFromString<List<MessageHit>>("""[{"sessionId":"a","role":"assistant","text":"x","at":"2026-11-09T09:00:00Z","title":"Importer"},{"sessionId":"b","role":"user","text":"y"}]""")
        assertEquals("Importer · Claude · 3h", messageMeta(hits[0], now))
        assertEquals("Untitled · You", messageMeta(hits[1], now))
    }

    @Test fun boldsEachQueryWord() {
        val a = boldMatches("Retry the importer, retry again", "retry importer")
        assertEquals(listOf(0 to 5, 10 to 18, 20 to 25), a.spanStyles.map { it.start to it.end }.sortedBy { it.first })
    }
}

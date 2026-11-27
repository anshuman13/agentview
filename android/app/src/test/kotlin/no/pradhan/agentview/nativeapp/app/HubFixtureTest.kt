package no.pradhan.agentview.nativeapp.app

import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.ServerMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HubFixtureTest {
    @Test fun readsOneMessageOrAnArray() {
        val init = fixtureMessages("""{"type":"init","state":{"session":{"id":"fx"},"events":[]}}""")
        assertEquals("fx", (init.single() as ServerMessage.Init).chatId)
        val chunks = fixtureMessages("""[{"type":"append","id":"a","offset":0,"text":"hi"},{"type":"append","id":"a","offset":2,"text":"!"}]""")
        assertEquals(2, chunks.size)
        assertTrue(chunks.all { it is ServerMessage.Append })
    }

    @Test fun keepsTheFixtureChatInTheLiveList() {
        val fx = LiveChat("fx")
        val live = withFixture(ServerMessage.Live(listOf(LiveChat("a"))), fx, "fx") as ServerMessage.Live
        assertEquals(listOf("a", "fx"), live.chats.map { it.id })
        assertEquals(live, withFixture(live, fx, "fx"))
        val other = ServerMessage.Error("x")
        assertEquals(other, withFixture(other, fx, "a"))
        assertEquals(other, withFixture(other, null, "fx"))
    }

    @Test fun dropsServerMessagesWhileTheFixtureIsShown() {
        assertNull(withFixture(ServerMessage.Error("x"), LiveChat("fx"), "fx"))
    }
}

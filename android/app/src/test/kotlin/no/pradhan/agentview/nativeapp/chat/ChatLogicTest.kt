package no.pradhan.agentview.nativeapp.chat

import java.time.Instant
import java.time.ZoneId
import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.LiveAgent
import no.pradhan.agentview.nativeapp.ops.Agent
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatLogicTest {
    private fun loaded(id: String) = Agent(id, Item.Agent(id, ChatEvent(id, "tool_use", name = "Agent"), null, true, null, emptyList()), null, "Loaded", "", null, "", "running", 0, null, "", 0)

    @Test fun unseenAgentsAreTheRunningOnesNotLoaded() {
        val a = LiveAgent("a", "Search the docs", startedAt = 1000)
        val b = LiveAgent("b")
        assertEquals(listOf(a, b), unseenAgents(listOf(a, b), emptyList()))
        assertEquals(listOf(b), unseenAgents(listOf(a, b), listOf(loaded("a"))))
        assertEquals(emptyList<LiveAgent>(), unseenAgents(emptyList(), listOf(loaded("a"))))
    }

    @Test fun replyTimeIsAgoThenClockThenDay() {
        codexZone = ZoneId.of("UTC")
        val now = Instant.parse("2026-11-20T15:00:00Z").toEpochMilli()
        assertEquals("now", replyTime(now - 30_000, now))
        assertEquals("2m", replyTime(now - 120_000, now))
        assertEquals("12:00", replyTime(now - 3 * 3_600_000, now))
        assertEquals("19 Nov 14:20", replyTime(Instant.parse("2026-11-19T14:20:00Z").toEpochMilli(), now))
    }

    @Test fun lastReplyAtSkipsSubagentAndEmptyReplies() {
        val events = listOf(
            ChatEvent("1", "assistant", text = "Done", at = 1000),
            ChatEvent("2", "assistant", text = "From an agent", at = 2000, parent = "t"),
            ChatEvent("3", "assistant", text = " ", at = 3000),
        )
        assertEquals(1000L, lastReplyAt(events))
        assertEquals(null, lastReplyAt(listOf(ChatEvent("1", "user", text = "Hi", at = 1000))))
    }
}

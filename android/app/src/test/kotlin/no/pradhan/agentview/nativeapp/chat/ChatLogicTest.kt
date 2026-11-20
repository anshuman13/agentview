package no.pradhan.agentview.nativeapp.chat

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
}

package no.pradhan.agentview.nativeapp.codex.autopilot

import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.PlanUsage
import no.pradhan.agentview.nativeapp.net.UsageWindow
import org.junit.Assert.assertEquals
import org.junit.Test

class GoalLogicTest {
    @Test fun usageLineAppendsTheBuildLimit() {
        val week = PlanUsage(week = UsageWindow(42.0))
        assertEquals("Week 42% of 70% cap · Builds 2 of 5", usageLine(ChatRun("a", capPct = 70, maxBuilds = 5, builds = 2, usage = week)))
        assertEquals("70% cap · Builds 2 of 5", usageLine(ChatRun("a", capPct = 70, maxBuilds = 5, builds = 2)))
        assertEquals("Builds 2 of 5", usageLine(ChatRun("a", maxBuilds = 5, builds = 2)))
        assertEquals("70% cap", usageLine(ChatRun("a", capPct = 70)))
        assertEquals("No cap", usageLine(ChatRun("a")))
    }
}

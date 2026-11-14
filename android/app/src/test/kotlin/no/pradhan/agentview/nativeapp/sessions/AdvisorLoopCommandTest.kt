package no.pradhan.agentview.nativeapp.sessions

import org.junit.Assert.assertEquals
import org.junit.Test

class AdvisorLoopCommandTest {
    @Test
    fun startsA4hGoalWithA70PercentCapAnd5BuildsAndNoStop() {
        assertEquals("/goal every 4h cap 70% builds 5 ${advisorLoopGoal("/w/app")}", advisorLoopCommand("/w/app", 0))
    }
}

package no.pradhan.agentview.nativeapp.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BuildsLogicTest {
    private val phases = listOf(BuildPhase("requirements", "r"), BuildPhase("design", "d"), BuildPhase("tasks", "t"))

    @Test
    fun parsesTheCriteriaAndFlowAndDefaultsThemWhenAbsent() {
        val d = parseBuild("""{"slug":"a","pipeline":"tested","criteria":[{"n":1,"result":"pass","evidence":"ok","text":"Shows","ui":true}],"flow":[{"key":"spec","state":"done","by":"pm","result":"Written","at":5},{"key":"merge","state":"todo","by":"","result":"","at":null}]}""")
        assertEquals("Tested", pipelineLabel(d.pipeline))
        assertEquals(listOf(true), d.criteria.map { it.ui })
        assertEquals(listOf(5L, null), d.flow.map { it.at })
        val bare = parseBuild("""{"slug":"b"}""")
        assertEquals("written", bare.pipeline)
        assertEquals(emptyList<SpecCriterion>(), bare.criteria)
        assertEquals(emptyList<FlowStep>(), bare.flow)
    }

    @Test
    fun phaseStripOpensOnTheFirstUnapprovedPhaseAndApproveMovesOn() {
        fun review(phase: String, decision: String) = BuildReview(phase, decision, "", 1)
        assertEquals("requirements", startPhase(phases, emptyList()))
        assertEquals("design", startPhase(phases, listOf(review("requirements", "approve"))))
        assertEquals("requirements", startPhase(phases, listOf(review("requirements", "approve"), review("requirements", "changes"))))
        assertEquals("requirements", startPhase(phases, phases.map { review(it.key, "approve") }))
        assertEquals("design", nextPhase(phases, "requirements"))
        assertEquals("tasks", nextPhase(phases, "tasks"))
        assertEquals("tasks", nextPhase(phases.filter { it.key != "design" }, "requirements"))
    }

    @Test
    fun buildAgentsAreNamedByLabelOrSpecPath() {
        assertEquals("implement" to "x", buildStageOf("general-purpose", "impl:x#2", "")?.let { it.stage to it.slug })
        assertEquals("review" to "pink-door", buildStageOf("spec-reviewer", "Review it", "Read .claude/specs/pink-door.md")?.let { it.stage to it.slug })
        assertNull(buildStageOf("general-purpose", "look around", "Read .claude/specs/pink-door.md"))
        assertNull(buildStageOf("pm", "pm:..", ""))
        assertEquals("sketch" to "x", buildStageOf("general-purpose", "sketch:x#1", "")?.let { it.stage to it.slug })
        assertEquals("Sketch", stageName("sketch"))
        assertEquals("Sketch", FLOW_LABEL["sketch"])
        assertEquals("Sketch", phaseLabel("sketch"))
    }

    @Test
    fun decisionTitles() {
        assertEquals("Not reviewed", decisionTitle(null))
        assertEquals("Changes requested", decisionTitle(BuildReview("design", "changes", "x", 1)))
    }
}

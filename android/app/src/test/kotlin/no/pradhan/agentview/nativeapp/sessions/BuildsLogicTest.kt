package no.pradhan.agentview.nativeapp.sessions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BuildsLogicTest {
    private fun row(slug: String, pipeline: String = "written", draft: Boolean = false) = BuildRow(slug, pipeline = pipeline, draft = draft)
    private val phases = listOf(BuildPhase("requirements", "r"), BuildPhase("design", "d"), BuildPhase("tasks", "t"))

    @Test
    fun parsesThePipelineAndMapsItToTheServersLabels() {
        val rows = parseBuilds("""[{"slug":"a","pipeline":"code-reviewed","draft":false},{"slug":"b","pipeline":"written","draft":true}]""")
        assertEquals(listOf("Code reviewed", "Spec written"), rows.map { pipelineLabel(it.pipeline) })
        assertEquals(listOf(false, true), rows.map { it.draft })
    }

    @Test
    fun groupsKeepActiveOpenAndLeaveEmptyGroupsOut() {
        val groups = buildGroups(listOf(row("a", "tested"), row("b", draft = true), row("c", "merged"), row("d", draft = true)))
        assertEquals(listOf("active", "drafts", "merged"), groups.map { it.key })
        assertEquals(listOf(1, 2, 1), groups.map { it.rows.size })
        assertEquals(listOf("drafts"), buildGroups(listOf(row("b", draft = true))).map { it.key })
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
    }

    @Test
    fun stagesInterleaveYourDecisionsWithTheAgentsInTimeOrder() {
        val entries = listOf(BuildEntry("e1", "pm", startedAt = 10), BuildEntry("e2", "review", startedAt = 30))
        val rows = stageRows(entries, listOf(BuildReview("requirements", "approve", "", 20)))
        assertEquals(listOf("e1", "you", "e2"), rows.map { it.entry?.id ?: "you" })
        val held = stageRows(entries, listOf(BuildReview("hold", "hold", "", 20), BuildReview("code", "approve", "", 25)))
        assertEquals(listOf("e1", "you", "e2"), held.map { it.entry?.id ?: "you" })
        assertEquals("Not reviewed", decisionTitle(null))
        assertEquals("Changes requested", decisionTitle(BuildReview("design", "changes", "x", 1)))
    }
}

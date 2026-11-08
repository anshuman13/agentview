package no.pradhan.agentview.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BranchPrTest {
    private val prs = listOf(PullRequest(1, branch = "a"), PullRequest(2, branch = "feat", checks = "failure", review = "APPROVED"))

    @Test fun findsThePrOfTheBranch() {
        assertEquals(2, branchPr(prs, "feat")?.number)
        assertNull(branchPr(prs, "main"))
        assertNull(branchPr(listOf(PullRequest(3)), ""))
    }

    @Test fun summarisesReadiness() {
        assertEquals("#2 · Checks failed · Approved", prStripMeta(prs[1]))
        assertEquals("#4 · Draft", prStripMeta(PullRequest(4, draft = true)))
    }
}

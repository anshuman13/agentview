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

    @Test fun draftsAFixForFailedChecksAndRequestedChanges() {
        val d = PullRequestDetail(
            checks = listOf(PrCheck("lint", "failure"), PrCheck("test", "success"), PrCheck("build", "failure")),
            reviews = listOf(PrReview("ana", "CHANGES_REQUESTED"), PrReview("bo", "APPROVED")),
        )
        assertEquals("PR #7: fix the failing checks (lint, build) and the changes ana requested. Read the logs and review comments with gh, push the fix, and tell me what changed.", fixPrPrompt(7, d))
        assertNull(fixPrPrompt(7, PullRequestDetail(checks = listOf(PrCheck("test", "success")))))
    }

    @Test fun readsTheBranchDiff() {
        val diff = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n x\n+y\n"
        val b = parseBranchDiff("""{"base":"main","files":[{"path":"README.md","add":1,"del":0}],"diff":${kotlinx.serialization.json.JsonPrimitive(diff)}}""")
        assertEquals("main", b.base)
        assertEquals(1, b.files.single().add)
        assertEquals(true, splitDiff(b.diff)["README.md"]?.contains("+y"))
    }
}

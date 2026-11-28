package no.pradhan.agentview.nativeapp.workspace

import org.junit.Assert.assertEquals
import org.junit.Test

class GitLogicTest {
    @Test fun theDefaultBranchNamesItsCommitsNotPushed() = assertEquals("Not pushed", committedLabel("main", "main"))

    @Test fun anotherBranchNamesTheBase() = assertEquals("Committed since main", committedLabel("feature", "main"))

    @Test fun aBlankBranchNamesTheBase() = assertEquals("Committed since main", committedLabel(null, "main"))

    @Test fun theUncommittedScopeNamesItself() = assertEquals("Uncommitted changes", committedLabel("main", "HEAD", UNCOMMITTED))

    @Test fun toggledOpenAddsAndRemovesAPath() {
        assertEquals(listOf("a", "b"), toggledOpen(listOf("a"), "b"))
        assertEquals(emptyList<String>(), toggledOpen(listOf("a"), "a"))
    }

    @Test fun diffPathPassesBaseAndWsOnlyWhenSet() {
        assertEquals("/api/git/branch", diffPath("branch", mapOf("base" to null), false))
        assertEquals("/api/git/branch?base=feat%2Fx%20y&ws=0", diffPath("branch", mapOf("base" to "feat/x y"), true))
        assertEquals("/api/git/show?hash=abc123", diffPath("show", mapOf("hash" to "abc123"), false))
    }
}

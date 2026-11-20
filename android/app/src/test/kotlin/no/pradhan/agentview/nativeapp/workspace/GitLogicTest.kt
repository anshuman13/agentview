package no.pradhan.agentview.nativeapp.workspace

import org.junit.Assert.assertEquals
import org.junit.Test

class GitLogicTest {
    @Test fun theDefaultBranchNamesItsCommitsNotPushed() = assertEquals("Not pushed", committedLabel("main", "main"))

    @Test fun anotherBranchNamesTheBase() = assertEquals("Committed since main", committedLabel("feature", "main"))

    @Test fun aBlankBranchNamesTheBase() = assertEquals("Committed since main", committedLabel("", "main"))
}

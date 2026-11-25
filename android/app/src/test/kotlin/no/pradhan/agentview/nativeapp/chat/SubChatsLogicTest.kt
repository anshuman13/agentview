package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.Round
import no.pradhan.agentview.nativeapp.net.SubChat
import no.pradhan.agentview.nativeapp.net.SubChatCommit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Mirrors web chat/transcript/subChatsLogic.test.ts.
class SubChatsLogicTest {
    private val spec = ".claude/specs/x.md"
    private val md = "Goal: x\n\n## Requirements\n\n- [ ] not a task\n\n## Tasks\n\n- [x] Add the store\n- [~] Wire it up (blocked)\n- [ ] Write docs\n\n## After\n- [ ] no"
    private fun brief(n: Int, of: Int) = "Build run, task $n of $of. Read $spec and .claude/specs/x.notes.md if it exists, then do only the first unchecked task."

    @Test fun titleReadsTheBuildBrief() {
        assertEquals(Brief(2, 3, spec), parseBrief(brief(2, 3)))
        assertEquals("Task 1 of 3: Add the store", subChatTitle(brief(1, 3), specTasks(md)))
        assertEquals("Task 9 of 9", subChatTitle(brief(9, 9), specTasks(md)))
        assertEquals("Task 2 of 3", subChatTitle(brief(2, 3)))
    }

    @Test fun titleIsTheFirstPromptWithoutMentions() {
        assertEquals("fix the header", subChatTitle("fix @web/src/a.ts the\n  header  @b"))
        assertEquals("Untitled", subChatTitle(""))
    }

    @Test fun specTasksReadsOnlyTheTasksSection() {
        assertEquals(listOf("Add the store", "Wire it up (blocked)", "Write docs"), specTasks(md))
    }

    @Test fun rowJoinsTitleRoundAndCommit() {
        val sub = SubChat("s1", brief(1, 3), 1, Round(1, 2, "done", "added the store"), SubChatCommit("a1b2c3d4e5f6", "Add the store"))
        assertEquals(listOf("Task 1 of 3: Add the store", "done: added the store", "a1b2c3d Add the store"), subChatRow(sub, specTasks(md)))
        assertEquals(listOf("hi"), subChatRow(SubChat("s2", "hi", 1)))
        assertEquals(spec, chainSpec(listOf(SubChat("r", "/build x"), sub)))
        assertNull(chainSpec(listOf(SubChat("r", "hi"))))
    }

    @Test fun foldKeepsTheLastFive() {
        val rows = listOf(1, 2, 3, 4, 5, 6, 7)
        assertEquals(Folded(listOf(3, 4, 5, 6, 7), 2), foldRows(rows, false))
        assertEquals(Folded(rows, 0), foldRows(rows, true))
        assertEquals(Folded(listOf(1, 2), 0), foldRows(listOf(1, 2), false))
    }
}

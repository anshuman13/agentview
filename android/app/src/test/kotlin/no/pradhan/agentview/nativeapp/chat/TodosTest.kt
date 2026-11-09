package no.pradhan.agentview.nativeapp.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class TodosTest {
    @Test fun memoryWhereNamesRepoAccountAndMemory() {
        val cwd = "/Users/me/repo"
        assertEquals("Repo instructions", memoryWhere(MemoryFile("$cwd/CLAUDE.md", "CLAUDE.md"), cwd))
        assertEquals("Global instructions · .claude-alt", memoryWhere(MemoryFile("/Users/me/.claude-alt/CLAUDE.md", "CLAUDE.md"), cwd))
        assertEquals("Memory · .claude", memoryWhere(MemoryFile("/Users/me/.claude/projects/-Users-me-repo/memory/git.md", "git"), cwd))
        assertEquals("Repo instructions", memoryWhere(MemoryFile("$cwd/AGENTS.md", "AGENTS.md"), cwd))
        assertEquals("Global instructions · .codex", memoryWhere(MemoryFile("/Users/me/.codex/AGENTS.md", "AGENTS.md"), cwd))
    }

    @Test fun ruleFileIsTheFirstInstructionFileInTheFolder() {
        assertEquals("AGENTS.md", ruleFile("/Users/me/repo", listOf("/Users/me/repo/AGENTS.md", "/Users/me/.codex/AGENTS.md")))
        assertEquals("CLAUDE.md", ruleFile("/Users/me/repo", emptyList()))
    }
}

package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.protocolJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TodosTest {
    @Test fun parsesAndPrompts() {
        val t = protocolJson.decodeFromString<Todos>("""{"todos":[{"path":"src/a.ts","line":12,"text":"retry on 429"},{"path":"b.py","line":4,"text":""}]}""").todos
        assertEquals("Resolve the TODO at src/a.ts:12 (\"retry on 429\"). Read the code around it, make the change, remove the comment and tell me what you did.", todoPrompt(t[0]))
        assertEquals("Resolve the TODO at b.py:4. Read the code around it, make the change, remove the comment and tell me what you did.", todoPrompt(t[1]))
        val ask = Todo("c.py", 9, "why retry twice", "?")
        assertEquals("AI? why retry twice", todoTitle(ask))
        assertTrue(todoPrompt(ask).startsWith("Answer the AI? comment at c.py:9"))
        assertTrue(todoPrompt(Todo("b.ts", 5, "make this async", "!")).startsWith("Do what the AI! comment at b.ts:5 asks"))
    }

    @Test fun memoryWhereNamesRepoAccountAndMemory() {
        val cwd = "/Users/me/repo"
        assertEquals("Repo instructions", memoryWhere(MemoryFile("$cwd/CLAUDE.md", "CLAUDE.md"), cwd))
        assertEquals("Global instructions · .claude-alt", memoryWhere(MemoryFile("/Users/me/.claude-alt/CLAUDE.md", "CLAUDE.md"), cwd))
        assertEquals("Memory · .claude", memoryWhere(MemoryFile("/Users/me/.claude/projects/-Users-me-repo/memory/git.md", "git"), cwd))
    }
}

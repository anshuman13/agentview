package no.pradhan.agentview.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Test

class TodosTest {
    @Test fun parsesAndPrompts() {
        val t = protocolJson.decodeFromString<Todos>("""{"todos":[{"path":"src/a.ts","line":12,"text":"retry on 429"},{"path":"b.py","line":4,"text":""}]}""").todos
        assertEquals("Resolve the TODO at src/a.ts:12 (\"retry on 429\"). Read the code around it, make the change, remove the comment and tell me what you did.", todoPrompt(t[0]))
        assertEquals("Resolve the TODO at b.py:4. Read the code around it, make the change, remove the comment and tell me what you did.", todoPrompt(t[1]))
    }
}

package no.pradhan.agentview.nativeapp.codex

import java.io.File
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.pradhan.agentview.nativeapp.net.protocolJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun change(id: String, title: String, status: String, t: Long, version: Int, table: String = "items") =
    """{"table":"$table","id":"$id","profile":"work","deleted":false,"updated_at":$t,"version":$version,"fields":{"title":"$title","status":"$status","at":null},"field_times":{"title":$t,"status":$t,"at":$t}}"""

private fun reply(version: Int, vararg changes: String, more: Boolean = false, rejected: String = "[]") =
    """{"version":$version,"hasMore":$more,"rejected":$rejected,"changes":[${changes.joinToString(",")}]}"""

@OptIn(ExperimentalCoroutinesApi::class)
class CodexStoreTest {
    class Fake(var pulls: MutableList<String>, var pushes: MutableList<String> = mutableListOf()) {
        val pulled = mutableListOf<Pair<Long, Boolean>>()
        var pushReply = reply(9)
    }

    private fun store(scope: TestScope, fake: Fake, writable: () -> Boolean = { true }, notices: MutableList<String> = mutableListOf(), cache: File? = null) = CodexStore(
        scope, { since, full -> fake.pulled.add(since to full); fake.pulls.removeAt(0) }, { body -> fake.pushes.add(body); fake.pushReply }, writable, { notices.add(it) }, { 5000L }, EmptyCoroutineContext, cache,
    )

    @Test fun pullsEveryPageAndKeepsOnlyTheSyncedTables() = runTest {
        val fake = Fake(mutableListOf(
            reply(5, change("a", "one", "open", 100, 1), change("x", "wiki", "live", 100, 1, "people"), more = true),
            reply(7, change("b", "two", "done", 200, 2), change("m", "Standup", "live", 100, 1, "meetings")),
        ))
        val s = store(this, fake)
        s.sync()
        assertEquals(listOf(0L to true, 5L to false), fake.pulled)
        val st = s.state.value
        assertEquals(listOf("one", "two"), st.items.map { it.title })
        assertEquals(1, st.meetings.size)
        assertTrue(st.loaded)
        assertNull(st.error)
    }

    @Test fun anEditIsPushedOnceAndThenClean() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1))))
        val s = store(this, fake)
        s.sync()
        assertTrue(s.update(s.state.value.items[0], mapOf("status" to "done")))
        assertEquals("done", s.state.value.items[0].status)
        assertEquals(1, s.state.value.pending)
        advanceUntilIdle()
        assertEquals(1, fake.pushes.size)
        val sent = protocolJson.parseToJsonElement(fake.pushes[0]).jsonObject
        val c = sent["changes"]!!.jsonArray[0].jsonObject
        assertEquals("a", c["id"]!!.jsonPrimitive.content)
        assertEquals("done", c["fields"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals("5000", c["field_times"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(0, s.state.value.pending)
    }

    @Test fun aRejectedChangeStaysQueuedAndShowsTheError() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1))))
        val s = store(this, fake)
        s.sync()
        s.update(s.state.value.items[0], mapOf("title" to "new"))
        fake.pushReply = reply(6, rejected = """[{"table":"items","id":"a","reason":"bad"}]""")
        advanceUntilIdle()
        assertEquals(1, s.state.value.pending)
        assertEquals("1 change rejected: bad", s.state.value.error)
    }

    @Test fun readOnlyBlocksEveryWrite() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1))))
        val notices = mutableListOf<String>()
        val s = store(this, fake, { false }, notices)
        s.sync()
        val row = s.state.value.items[0]
        assertFalse(s.update(row, mapOf("status" to "done")))
        assertNull(s.capture("new", "open", WORK))
        assertFalse(s.move(row, PERSONAL))
        advanceUntilIdle()
        assertEquals("open", s.state.value.items[0].status)
        assertEquals(1, s.state.value.items.size)
        assertTrue(fake.pushes.isEmpty())
        assertEquals(listOf(READ_ONLY_NOTICE, READ_ONLY_NOTICE, READ_ONLY_NOTICE), notices)
    }

    @Test fun captureAddsARowAndPushesIt() = runTest {
        val fake = Fake(mutableListOf(reply(5)))
        val s = store(this, fake)
        s.sync()
        val r = s.capture("Call bank", "open", WORK, at = 123, extra = mapOf("priority" to 2))
        assertNotNull(r)
        assertEquals(1, s.state.value.items.size)
        advanceUntilIdle()
        val c = protocolJson.parseToJsonElement(fake.pushes[0]).jsonObject["changes"]!!.jsonArray[0].jsonObject
        assertEquals("Call bank", c["fields"]!!.jsonObject["title"]!!.jsonPrimitive.content)
        assertEquals("2", c["fields"]!!.jsonObject["priority"]!!.jsonPrimitive.content)
    }

    @Test fun moveCopiesTheItemAndDeletesTheOriginal() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1))))
        val s = store(this, fake)
        s.sync()
        s.move(s.state.value.items[0], PERSONAL)
        val items = s.state.value.items
        assertEquals(2, items.size)
        assertEquals(PERSONAL, items.first { !it.deleted }.profile)
        assertEquals("one", items.first { !it.deleted }.title)
        assertTrue(items.first { it.profile == WORK }.deleted)
    }

    @Test fun aFailedPullKeepsTheRowsAndReportsTheError() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1)), "not json"))
        val s = store(this, fake)
        s.sync()
        s.sync()
        assertEquals(1, s.state.value.items.size)
        assertNotNull(s.state.value.error)
    }

    @Test fun aRestartShowsTheCachedRowsAndPullsOnlyWhatChanged() = runTest {
        val file = File.createTempFile("codex", ".json").also { it.delete() }
        store(this, Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1)))), cache = file).sync()
        val fake = Fake(mutableListOf(reply(6, change("a", "two", "open", 200, 2))))
        val s = store(this, fake, cache = file)
        s.restore()
        assertEquals(listOf("one"), s.state.value.items.map { it.title })
        assertTrue(s.state.value.loaded)
        s.sync()
        assertEquals(listOf(5L to false), fake.pulled)
        assertEquals(listOf("two"), s.state.value.items.map { it.title })
        file.parentFile.listFiles { f -> f.name.startsWith(file.name) }?.forEach { it.delete() }
    }
}

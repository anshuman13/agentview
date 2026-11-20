package no.pradhan.agentview.nativeapp.codex

import java.io.File
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.pradhan.agentview.nativeapp.net.ApiError
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

    @Test fun aRowIsParkedOnItsThirdRejectAndEditingSendsItAgain() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1)), reply(9), reply(9)))
        val notices = mutableListOf<String>()
        val s = store(this, fake, notices = notices)
        s.sync()
        s.update(s.state.value.items[0], mapOf("title" to "new"))
        fake.pushReply = reply(6, rejected = """[{"table":"items","id":"a","reason":"bad"}]""")
        advanceUntilIdle()
        s.sync()
        assertEquals("1 change rejected: bad", s.state.value.error)
        assertEquals(emptyList<String>(), notices)
        s.sync()
        assertEquals(3, fake.pushes.size)
        assertEquals(listOf("1 change not synced, edit it to retry"), notices)
        assertNull(s.state.value.error)
        s.sync()
        assertEquals(3, fake.pushes.size)
        assertEquals(1, notices.size)
        assertEquals(1, s.state.value.pending)
        s.update(s.state.value.items[0], mapOf("title" to "newer"))
        advanceUntilIdle()
        assertEquals(4, fake.pushes.size)
    }

    @Test fun theErrorNamesOnlyTheRowsNotParked() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1), change("b", "two", "open", 100, 1)), reply(9)))
        val notices = mutableListOf<String>()
        val s = store(this, fake, notices = notices)
        s.sync()
        s.update(s.state.value.items[0], mapOf("title" to "x"))
        fake.pushReply = reply(6, rejected = """[{"table":"items","id":"a","reason":"no a"}]""")
        advanceUntilIdle()
        s.sync()
        s.update(s.state.value.items[1], mapOf("title" to "y"))
        fake.pushReply = reply(6, rejected = """[{"table":"items","id":"a","reason":"no a"},{"table":"items","id":"b","reason":"no b"}]""")
        advanceUntilIdle()
        assertEquals(listOf("1 change not synced, edit it to retry"), notices)
        assertEquals("1 change rejected: no b", s.state.value.error)
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

    private fun flaky(scope: TestScope, pull: suspend () -> String) =
        CodexStore(scope, { _, _ -> pull() }, { reply(9) }, { true }, {}, { 5000L }, EmptyCoroutineContext, null)

    @Test fun anUnreachableHubIsRetriedInsideOneSyncThatAnotherSyncWakes() = runTest {
        var calls = 0
        val s = flaky(this) { if (++calls < 3) throw ApiError("Assistant hub unreachable", 502) else reply(5, change("a", "one", "open", 100, 1)) }
        launch { s.sync() }
        runCurrent()
        assertEquals(1, calls)
        assertTrue(s.state.value.reconnecting)
        assertNull(s.state.value.error)
        s.sync()
        runCurrent()
        assertEquals(2, calls)
        advanceUntilIdle()
        assertEquals(3, calls)
        assertFalse(s.state.value.reconnecting)
        assertNull(s.state.value.error)
        assertEquals(1, s.state.value.items.size)
    }

    @Test fun aSyncCancelledDuringTheRetryWaitLeavesTheNextSyncFree() = runTest {
        var calls = 0
        val s = flaky(this) { if (++calls < 2) throw ApiError("Assistant hub unreachable", 502) else reply(5, change("a", "one", "open", 100, 1)) }
        val job = launch { s.sync() }
        runCurrent()
        assertTrue(s.state.value.reconnecting)
        job.cancel()
        runCurrent()
        assertFalse(s.state.value.reconnecting)
        s.sync()
        assertEquals(2, calls)
        assertEquals(1, s.state.value.items.size)
    }

    @Test fun aSyncStartedDuringAnAttemptRunsOnceMoreInsteadOfItsOwnLoop() = runTest {
        var calls = 0
        val gate = CompletableDeferred<Unit>()
        val s = flaky(this) { if (++calls == 1) { gate.await(); throw ApiError("Assistant hub unreachable", 502) } else reply(5, change("a", "one", "open", 100, 1)) }
        launch { s.sync() }
        runCurrent()
        launch { s.sync() }
        runCurrent()
        assertEquals(1, calls)
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(2, calls)
        assertFalse(s.state.value.reconnecting)
        assertEquals(1, s.state.value.items.size)
    }

    @Test fun parkedRowsDoNotStopTheCacheBeingWritten() = runTest {
        val file = File.createTempFile("codex", ".json").also { it.delete() }
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1))))
        val s = store(this, fake, cache = file)
        s.sync()
        s.update(s.state.value.items[0], mapOf("title" to "new"))
        fake.pushReply = reply(6, rejected = """[{"table":"items","id":"a","reason":"bad"}]""")
        advanceUntilIdle()
        s.sync()
        s.sync()
        assertEquals(1, s.state.value.pending)
        val again = store(this, Fake(mutableListOf()), cache = file)
        again.restore()
        assertEquals(listOf("new"), again.state.value.items.map { it.title })
        file.parentFile.listFiles { f -> f.name.startsWith(file.name) }?.forEach { it.delete() }
    }

    @Test fun theErrorShowsAfterTheLastRetryFails() = runTest {
        var calls = 0
        val s = flaky(this) { calls++; throw ApiError("Assistant hub unreachable", 502) }
        s.sync()
        assertEquals(4, calls)
        assertFalse(s.state.value.reconnecting)
        assertEquals("Can't reach the hub", s.state.value.error)
    }

    @Test fun aServerErrorKeepsItsMessage() = runTest {
        val s = flaky(this) { throw ApiError("Unknown column", 400) }
        s.sync()
        assertEquals("Unknown column", s.state.value.error)
    }

    @Test fun aRestartShowsTheCachedRowsAndPullsOnlyWhatChanged() = runTest {
        val file = File.createTempFile("codex", ".json").also { it.delete() }
        val first = store(this, Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1)))), cache = file)
        first.sync()
        val fake = Fake(mutableListOf(reply(6, change("a", "two", "open", 200, 2))))
        val s = store(this, fake, cache = file)
        s.restore()
        assertEquals(listOf("one"), s.state.value.items.map { it.title })
        assertTrue(s.state.value.loaded)
        assertEquals(first.state.value.lastSync, s.state.value.lastSync)
        assertTrue(s.state.value.lastSync > 0)
        s.sync()
        assertEquals(listOf(5L to false), fake.pulled)
        assertEquals(listOf("two"), s.state.value.items.map { it.title })
        file.parentFile.listFiles { f -> f.name.startsWith(file.name) }?.forEach { it.delete() }
    }

    @Test fun logTimeAddsToSpentAndUndoRestoresIt() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1))))
        val s = store(this, fake)
        s.sync()
        val snacks = mutableListOf<Pair<String, (() -> Unit)?>>()
        val actions = TaskActions(s, { t, u -> snacks.add(t to u) }, { 5000L })
        actions.logTime(s.state.value.items[0], 15)
        assertEquals(15L, s.state.value.items[0].long("spent"))
        actions.logTime(s.state.value.items[0], 60)
        assertEquals(75L, s.state.value.items[0].long("spent"))
        assertEquals("Logged 1h", snacks[1].first)
        snacks[1].second!!()
        assertEquals(15L, s.state.value.items[0].long("spent"))
        snacks[0].second!!()
        assertEquals(null, s.state.value.items[0].long("spent"))
    }

    @Test fun dismissTakesTheSnackTextAndUndoRestoresTheStatus() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "suggested", 100, 1))))
        val s = store(this, fake)
        s.sync()
        val snacks = mutableListOf<Pair<String, (() -> Unit)?>>()
        val actions = TaskActions(s, { t, u -> snacks.add(t to u) }, { 5000L })
        actions.dismiss(s.state.value.items[0], "Moved to Not mine")
        assertEquals("dismissed", s.state.value.items[0].status)
        assertEquals("Moved to Not mine", snacks[0].first)
        snacks[0].second!!()
        assertEquals("suggested", s.state.value.items[0].status)
    }

    @Test fun bulkActionsShowOneSnackAndUndoSkipsARowEditedSince() = runTest {
        val fake = Fake(mutableListOf(reply(5, change("a", "one", "open", 100, 1), change("b", "two", "open", 100, 1))))
        val s = store(this, fake)
        s.sync()
        val snacks = mutableListOf<Pair<String, (() -> Unit)?>>()
        val actions = TaskActions(s, { t, u -> snacks.add(t to u) }, { 5000L })
        val rows = s.state.value.items
        actions.bulk(rows, BulkKind.Done)
        assertEquals(listOf("done", "done"), s.state.value.items.map { it.status })
        assertEquals(1, snacks.size)
        assertEquals("Done 2 tasks", snacks[0].first)
        s.update(s.state.value.items[1], mapOf("status" to "open"))
        snacks[0].second!!()
        assertEquals(listOf("open", "open"), s.state.value.items.map { it.status })
        actions.bulk(listOf(s.state.value.items[0]), BulkKind.Delete)
        assertEquals("Deleted 1 task", snacks[1].first)
        assertEquals(listOf(true, false), s.state.value.items.map { it.deleted })
        snacks[1].second!!()
        assertEquals(listOf(false, false), s.state.value.items.map { it.deleted })
    }
}

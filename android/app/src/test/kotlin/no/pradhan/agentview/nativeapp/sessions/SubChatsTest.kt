package no.pradhan.agentview.nativeapp.sessions

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import no.pradhan.agentview.nativeapp.chat.MessageHit
import org.junit.Assert.assertEquals
import org.junit.Test

// The cases in shared/fixtures/sub-chats.json also run in shared/subChats.test.ts.
class SubChatsTest {
    private val fx = Json.parseToJsonElement(File("../../shared/fixtures/sub-chats.json").readText()).jsonObject
    private val json = Json { ignoreUnknownKeys = true }
    private fun cases(key: String) = fx.getValue(key).jsonArray.map { it.jsonObject }
    private fun JsonObject.str(key: String) = get(key)?.jsonPrimitive?.contentOrNull
    private fun links(o: JsonObject) = o.getValue("links").jsonObject.mapValues { json.decodeFromJsonElement<SubLink>(it.value) }

    @Test fun rootOf() {
        for (c in cases("rootOf")) assertEquals(c.str("name"), c.str("expected"), rootOf(links(c), c.str("id")!!))
    }

    @Test fun subChatLabel() {
        for (c in cases("subChatLabel")) {
            val count = c.getValue("count").jsonPrimitive.int
            assertEquals(c.str("expected"), subChatLabel(count, c.getValue("allBuild").jsonPrimitive.boolean))
        }
    }

    @Test fun subChatLabelBuilds() {
        for (c in cases("subChatLabelBuilds")) {
            val count = c.getValue("count").jsonPrimitive.int
            assertEquals(c.str("expected"), subChatLabel(count, c.getValue("allBuild").jsonPrimitive.boolean, c.getValue("builds").jsonPrimitive.int))
        }
    }

    private fun saved(c: JsonObject) = c.getValue("saved").jsonArray.map { json.decodeFromJsonElement<SavedSession>(it) }
    private fun open(c: JsonObject) = c.getValue("open").jsonArray.map { it.jsonObject }.map {
        OpenSession(it.str("sessionId"), it.str("parentId"), it["lastActive"]?.jsonPrimitive?.longOrNull ?: 0)
    }
    private fun ids(o: JsonObject, key: String) = o.getValue(key).jsonArray.map { it.jsonPrimitive.content }

    private fun checkGroups(key: String) {
        for (c in cases(key)) {
            val expected = c.getValue("expected").jsonArray.map { it.jsonObject }.map {
                listOf(it.str("root"), it.str("latest"), it.getValue("count").jsonPrimitive.int, it.str("label"),
                    it.getValue("lastModified").jsonPrimitive.long, ids(it, "members"), it.getValue("builds").jsonPrimitive.int, ids(it, "buildMembers"))
            }
            val actual = groupSessions(saved(c), open(c)).map {
                listOf(it.root.sessionId, it.latest, it.count, it.label, it.lastModified, it.members, it.builds, it.buildMembers)
            }
            assertEquals(c.str("name"), expected, actual)
        }
    }

    @Test fun groupSessions() = checkGroups("groupSessions")

    @Test fun groupSpawned() = checkGroups("groupSpawned")

    @Test fun needsRows() {
        for (c in cases("needsRows")) {
            val needs = ids(c, "needs")
            val actual = groupSessions(saved(c), open(c)).filter { r -> rowSessions(r).any { it in needs } }.map { it.root.sessionId }
            assertEquals(c.str("name"), ids(c, "expected"), actual)
        }
    }

    @Test fun searchHitRows() {
        for (c in cases("searchHitRows")) {
            val hits = c.getValue("hits").jsonArray.map { it.jsonObject }.map {
                MessageHit(it.str("sessionId")!!, "", it.str("text")!!, parentId = it.str("parentId"))
            }
            val expected = c.getValue("expected").jsonArray.map { it.jsonObject }.map { listOf(it.str("sessionId"), it.str("text"), it.str("session"), it.str("sub")) }
            assertEquals(c.str("name"), expected, searchHitRows(hits).map { listOf(it.hit.sessionId, it.hit.text, it.session, it.sub) })
        }
    }
}

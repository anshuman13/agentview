package no.pradhan.agentview.nativeapp.codex

import java.io.File
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.long
import no.pradhan.agentview.nativeapp.chat.ChecklistItem
import no.pradhan.agentview.nativeapp.chat.checklistCurrent
import no.pradhan.agentview.nativeapp.chat.checklistProgress
import no.pradhan.agentview.nativeapp.chat.editCount
import no.pradhan.agentview.nativeapp.chat.handoffText
import no.pradhan.agentview.nativeapp.chat.latestChecklist
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.chat.stripRound
import no.pradhan.agentview.nativeapp.codex.autopilot.RunEntry
import no.pradhan.agentview.nativeapp.codex.autopilot.TryColumn
import no.pradhan.agentview.nativeapp.codex.autopilot.runBands
import no.pradhan.agentview.nativeapp.codex.autopilot.runLine
import no.pradhan.agentview.nativeapp.codex.autopilot.tryColumn
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Edits
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.Round
import no.pradhan.agentview.nativeapp.net.RunTry
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.sessions.items
import no.pradhan.agentview.nativeapp.workspace.agoShort
import no.pradhan.agentview.nativeapp.workspace.fileDiff
import no.pradhan.agentview.nativeapp.workspace.revertBlock
import no.pradhan.agentview.nativeapp.workspace.reviewQueue
import no.pradhan.agentview.nativeapp.chat.appendRule
import no.pradhan.agentview.nativeapp.chat.can
import no.pradhan.agentview.nativeapp.chat.modelsFor
import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.ModelInfo
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.net.providerMark
import no.pradhan.agentview.nativeapp.net.providerModes
import no.pradhan.agentview.nativeapp.codex.jobs.money
import no.pradhan.agentview.nativeapp.workspace.isSpecPath
import no.pradhan.agentview.nativeapp.workspace.runAllPrompt
import no.pradhan.agentview.nativeapp.workspace.specProgress
import no.pradhan.agentview.nativeapp.workspace.specPrompt
import no.pradhan.agentview.nativeapp.workspace.specTasks
import no.pradhan.agentview.nativeapp.workspace.startTaskPrompt
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

// The cases in shared/fixtures also run in shared/cases.test.ts, so a case added there is checked against both implementations.
class SharedCasesTest {
    @Before fun zone() { codexZone = ZoneId.of("UTC") }

    private fun cases(file: String): List<JsonObject> =
        Json.parseToJsonElement(File("../../shared/fixtures/$file.json").readText()).jsonArray.map { it.jsonObject }

    private fun JsonObject.str(k: String) = getValue(k).jsonPrimitive.content

    private fun meetingRow(m: JsonObject, now: Long): Row {
        val f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as JsonElement }.toMutableMap()
        f["title"] = toJson(m.str("title"))
        f["starts_at"] = toJson(now + m.getValue("startsInHours").jsonPrimitive.long * 3_600_000)
        return Row("meetings", m.str("title"), m.str("profile"), deleted = m["deleted"]?.jsonPrimitive?.booleanOrNull == true, f = f)
    }

    @Test fun guessProfile() {
        val now = 1_800_000_000_000
        for (c in cases("guess-profile")) {
            val meetings = c.getValue("meetings").jsonArray.map { meetingRow(it.jsonObject, now) }
            assertEquals(c.str("name"), c.str("expected"), guessProfile(c.str("question"), meetings, c.str("fallback"), now))
        }
    }

    @Test fun editCount() {
        for (c in cases("edit-count")) {
            val expected = c["expected"]?.takeIf { it !is JsonNull }?.jsonObject?.let { it.getValue("add").jsonPrimitive.long.toInt() to it.getValue("del").jsonPrimitive.long.toInt() }
            assertEquals(c.str("name"), expected, editCount(c.str("tool"), c.getValue("input").jsonObject))
        }
    }

    @Test fun stripRound() {
        for (c in cases("strip-round")) assertEquals(c.str("name"), c.str("expected"), stripRound(c.str("text")))
    }

    @Test fun ago() {
        val now = 1_800_000_000_000
        for (c in cases("ago")) assertEquals(c.str("name"), c.str("expected"), agoShort(now - c.getValue("ageMs").jsonPrimitive.long, now, c.str("suffix")))
    }

    @Test fun checklist() {
        for (c in cases("checklist")) {
            val items = c.getValue("items").jsonArray.map { ChecklistItem(it.jsonObject.str("content"), it.jsonObject.str("activeForm"), it.jsonObject.str("status")) }
            assertEquals(c.str("name"), c.str("progress"), checklistProgress(items))
            assertEquals(c.str("name"), c.str("current"), checklistCurrent(items))
        }
    }

    private fun JsonObject.nullable(k: String) = this[k]?.takeIf { it !is JsonNull }

    private inline fun <reified T> JsonElement.decode(): T = protocolJson.decodeFromJsonElement(this)

    @Test fun handoffText() {
        for (c in cases("handoff-text")) assertEquals(c.str("name"), c.str("expected"), handoffText(c.str("sessionId")))
    }

    @Test fun latestChecklist() {
        for (c in cases("checklist-events")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            val expected = c.nullable("expected")?.jsonArray?.map { ChecklistItem(it.jsonObject.str("content"), it.jsonObject.str("activeForm"), it.jsonObject.str("status")) }
            assertEquals(c.str("name"), expected, latestChecklist(events))
        }
    }

    @Test fun runLine() {
        for (c in cases("run-line")) {
            val run = JsonObject(mapOf("id" to toJson("r")) + c.getValue("run").jsonObject).decode<ChatRun>()
            assertEquals(c.str("name"), c.str("expected"), runLine(run, c.nullable("phase")?.jsonPrimitive?.content))
        }
    }

    @Test fun runBands() {
        for (c in cases("run-bands")) {
            val runs = c.getValue("runs").jsonArray.map { it.decode<ChatRun>() }
            val b = runBands(runs, emptyList(), emptyList(), 0)
            val name = { e: RunEntry -> (e as RunEntry.Chat).run.id }
            val e = c.getValue("expected").jsonObject
            fun ids(k: String) = e.getValue(k).jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.str("name"), ids("needs"), b.needs.map(name))
            assertEquals(c.str("name"), ids("running"), b.running.map(name))
            assertEquals(c.str("name"), ids("finished"), b.finished.map { it.id })
        }
    }

    @Test fun tryColumn() {
        for (c in cases("try-column")) {
            val rounds = c.getValue("run").jsonObject.getValue("rounds").jsonArray.map { it.decode<Round>() }
            val t = c.getValue("try").decode<RunTry>()
            val live = c.getValue("live").jsonArray.map { it.decode<LiveChat>() }
            val e = c.getValue("expected").jsonObject
            val edits = e.nullable("edits")?.jsonObject?.let { Edits(it.getValue("add").jsonPrimitive.long.toInt(), it.getValue("del").jsonPrimitive.long.toInt()) }
            val expected = TryColumn(e.getValue("n").jsonPrimitive.long.toInt(), e.str("branch"), e.str("state"), e.str("line"), edits, e.getValue("cost").jsonPrimitive.content.toDouble(), e.getValue("archived").jsonPrimitive.booleanOrNull!!)
            assertEquals(c.str("name"), expected, tryColumn(ChatRun("r", rounds = rounds, tries = listOf(t)), t, live))
        }
    }

    @Test fun briefBullets() {
        for (c in cases("brief-bullets")) {
            val expected = c.getValue("expected").jsonArray.map { listOf(it.jsonObject.str("title"), it.jsonObject.nullable("url")?.jsonPrimitive?.content, it.jsonObject.str("why")) }
            assertEquals(c.str("name"), expected, briefBullets(c.str("text")).map { listOf(it.title, it.url, it.why) })
        }
    }

    @Test fun specTasks() {
        for (c in cases("spec-tasks")) {
            val tasks = specTasks(c.str("md"))
            val expected = c.getValue("tasks").jsonArray.map { it.jsonObject.let { t -> listOf(t.getValue("n").jsonPrimitive.long.toInt(), t.str("text"), t.getValue("done").jsonPrimitive.booleanOrNull, t.getValue("doing").jsonPrimitive.booleanOrNull) } }
            assertEquals(c.str("name"), expected, tasks.map { listOf(it.n, it.text, it.done, it.doing) })
            assertEquals(c.str("name"), c.getValue("isSpec").jsonPrimitive.booleanOrNull, isSpecPath(c.str("path")))
            assertEquals(c.str("name"), c.str("progress"), specProgress(tasks))
            assertEquals(c.str("name"), c.nullable("start")?.jsonPrimitive?.content, tasks.firstOrNull { !it.done }?.let { startTaskPrompt(it, c.str("path")) })
            assertEquals(c.str("name"), c.str("all"), runAllPrompt(c.str("path")))
        }
    }

    @Test fun appendRule() {
        for (c in cases("append-rule")) assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, appendRule(c.str("text"), c.str("rule")))
    }

    @Test fun revertBlock() {
        for (c in cases("revert-block")) assertEquals(c.str("name"), c.str("expected"), revertBlock(fileDiff(c.str("original"), c.str("content")), c.getValue("block").jsonPrimitive.int))
    }

    @Test fun specPrompt() {
        for (c in cases("spec-prompt")) assertEquals(c.str("name"), c.str("expected"), specPrompt(c.str("request")))
    }

    @Test fun parseWhen() {
        for (c in cases("parse-when")) {
            val w = parseWhen(c.str("text"), Instant.parse(c.str("now")).toEpochMilli())
            val actual = w?.let { listOf(it.at?.let { at -> Instant.ofEpochMilli(at).toString() }, it.spans.map { r -> r.first to r.last + 1 }, stripWhen(c.str("text"), it)) }
            val e = c.nullable("expected")?.jsonObject
            val expected = e?.let { listOf(it.nullable("at")?.jsonPrimitive?.content, it.getValue("spans").jsonArray.map { s -> s.jsonArray[0].jsonPrimitive.long.toInt() to s.jsonArray[1].jsonPrimitive.long.toInt() }, it.str("stripped")) }
            assertEquals(c.str("name"), expected, actual)
        }
    }

    @Test fun reviewQueue() {
        fun strings(c: JsonObject, k: String) = c.getValue(k).jsonArray.map { it.jsonPrimitive.content }
        for (c in cases("review-queue")) assertEquals(c.str("name"), strings(c, "expected"), reviewQueue(strings(c, "order"), strings(c, "skipped"), strings(c, "open").toSet()))
    }

    @Test fun capabilities() {
        for (c in cases("capabilities")) {
            val caps = c.nullable("capabilities")?.let { protocolJson.decodeFromJsonElement<Capabilities>(it) } ?: Capabilities()
            val models = c.getValue("models").jsonArray.map { ModelInfo(it.jsonPrimitive.content) }
            assertEquals(c.str("name"), c.getValue("shown").jsonArray.map { it.jsonPrimitive.content }, modelsFor(models, caps).map { it.value })
            for ((k, v) in c.getValue("can").jsonObject) assertEquals(c.str("name") + ": " + k, v.jsonPrimitive.booleanOrNull, caps.can(k))
        }
    }

    @Test fun providerTable() {
        for (c in cases("providers")) {
            val p = c.nullable("provider")?.jsonPrimitive?.content
            assertEquals(c.str("name"), c.str("label"), providerLabel(p))
            assertEquals(c.str("name"), c.str("billing"), billing(p))
            assertEquals(c.str("name"), c.nullable("mark")?.jsonPrimitive?.content, providerMark(p))
            assertEquals(c.str("name"), c.getValue("modes").jsonArray.map { it.jsonPrimitive.content }, providerModes(p).map { it.value })
        }
    }

    @Test fun moneyByBilling() {
        for (c in cases("money")) assertEquals(c.str("name"), c.str("expected"), money(c.getValue("n").jsonPrimitive.content.toDouble(), c.str("billing")))
    }
}

package no.pradhan.agentview.nativeapp.codex

import java.io.File
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.long
import no.pradhan.agentview.nativeapp.app.BarEvent
import no.pradhan.agentview.nativeapp.chat.mergeTail
import no.pradhan.agentview.nativeapp.app.BarState
import no.pradhan.agentview.nativeapp.app.FEATURES
import no.pradhan.agentview.nativeapp.app.appCounts
import no.pradhan.agentview.nativeapp.app.featureRows
import no.pradhan.agentview.nativeapp.app.shownFeature
import no.pradhan.agentview.nativeapp.app.barHidden
import no.pradhan.agentview.nativeapp.app.barState
import no.pradhan.agentview.nativeapp.app.countChat
import no.pradhan.agentview.nativeapp.chat.ChecklistItem
import no.pradhan.agentview.nativeapp.chat.checklistCurrent
import no.pradhan.agentview.nativeapp.chat.checklistProgress
import no.pradhan.agentview.nativeapp.chat.editCount
import no.pradhan.agentview.nativeapp.chat.handoffText
import no.pradhan.agentview.nativeapp.chat.latestChecklist
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.chat.statusLine
import no.pradhan.agentview.nativeapp.chat.stripRound
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalForm
import no.pradhan.agentview.nativeapp.codex.autopilot.RunEntry
import no.pradhan.agentview.nativeapp.codex.autopilot.TryColumn
import no.pradhan.agentview.nativeapp.codex.autopilot.goalCommand
import no.pradhan.agentview.nativeapp.codex.autopilot.parseEvery
import no.pradhan.agentview.nativeapp.codex.autopilot.planOf
import no.pradhan.agentview.nativeapp.codex.autopilot.runBands
import no.pradhan.agentview.nativeapp.codex.autopilot.runLine
import no.pradhan.agentview.nativeapp.codex.autopilot.tryColumn
import no.pradhan.agentview.nativeapp.sessions.BuildEntry
import no.pradhan.agentview.nativeapp.sessions.buildTotals
import no.pradhan.agentview.nativeapp.sessions.withoutCriteria
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Edits
import no.pradhan.agentview.nativeapp.net.LiveAgent
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.net.ModelInfo
import no.pradhan.agentview.nativeapp.net.newestModels
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
import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.net.menuModes
import no.pradhan.agentview.nativeapp.net.modeSteps
import no.pradhan.agentview.nativeapp.net.providerMark
import no.pradhan.agentview.nativeapp.net.providerModes
import no.pradhan.agentview.nativeapp.codex.jobs.money
import no.pradhan.agentview.nativeapp.codex.meetings.actionCount
import no.pradhan.agentview.nativeapp.codex.meetings.displayName
import no.pradhan.agentview.nativeapp.codex.meetings.filterMeetings
import no.pradhan.agentview.nativeapp.codex.meetings.groupMeetings
import no.pradhan.agentview.nativeapp.codex.meetings.inSeries
import no.pradhan.agentview.nativeapp.codex.meetings.meetingState
import no.pradhan.agentview.nativeapp.codex.meetings.sameName
import no.pradhan.agentview.nativeapp.codex.meetings.seriesTitle
import no.pradhan.agentview.nativeapp.ops.McpServer
import no.pradhan.agentview.nativeapp.ops.setupPrompt
import no.pradhan.agentview.nativeapp.workspace.isSketchPath
import no.pradhan.agentview.nativeapp.workspace.isSpecPath
import no.pradhan.agentview.nativeapp.workspace.sketchDoc
import no.pradhan.agentview.nativeapp.workspace.planCondition
import no.pradhan.agentview.nativeapp.workspace.buildPrompt
import no.pradhan.agentview.nativeapp.workspace.runAllPrompt
import no.pradhan.agentview.nativeapp.workspace.specProgress
import no.pradhan.agentview.nativeapp.workspace.specPrompt
import no.pradhan.agentview.nativeapp.workspace.specSlug
import no.pradhan.agentview.nativeapp.workspace.specTasks
import no.pradhan.agentview.nativeapp.workspace.withoutOpenTasks
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

    @Test fun mergeTail() {
        fun events(c: JsonObject, k: String) = c.getValue(k).jsonArray.map { ChatEvent(id = it.jsonPrimitive.content, kind = "user") }
        for (c in cases("merge-tail")) {
            val (merged, earlier) = mergeTail(events(c, "held"), c.getValue("heldEarlier").jsonPrimitive.int, events(c, "tail"), c.getValue("earlier").jsonPrimitive.int)
            assertEquals(c.str("name"), events(c, "expected").map { it.id }, merged.map { it.id })
            assertEquals(c.str("name"), c.getValue("expectedEarlier").jsonPrimitive.int, earlier)
        }
    }

    @Test fun stripRound() {
        for (c in cases("strip-round")) assertEquals(c.str("name"), c.str("expected"), stripRound(c.str("text")))
    }

    @Test fun specCriteria() {
        for (c in cases("spec-criteria")) assertEquals(c.str("name"), c.str("without"), withoutCriteria(c.str("markdown")))
    }

    @Test fun buildTotals() {
        val fixture = Json.parseToJsonElement(File("../../shared/fixtures/builds.json").readText()).jsonObject
        for (c in fixture.getValue("totals").jsonArray.map { it.jsonObject }) {
            val entries = c.getValue("entries").jsonArray.mapIndexed { i, e -> e.jsonObject.let { o ->
                BuildEntry("e$i", status = o.str("status"), startedAt = o.getValue("startedAt").jsonPrimitive.long, endedAt = o["endedAt"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.long, tokens = o["tokens"]?.jsonPrimitive?.long)
            } }
            val t = buildTotals(entries, c.getValue("now").jsonPrimitive.long)
            val want = c.getValue("expected").jsonObject
            assertEquals(c.str("name"), listOf(want.getValue("runs").jsonPrimitive.int, want.getValue("ms").jsonPrimitive.long, want.getValue("tokens").jsonPrimitive.long, want.getValue("partial").jsonPrimitive.boolean), listOf(t.runs, t.ms, t.tokens, t.partial))
        }
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

    @Test fun chatState() {
        for (c in cases("chat-state")) {
            val chat = c.getValue("chat").jsonObject
            val run = chat.nullable("run")?.jsonObject
            val nextAt = run?.nullable("nextAtLocal")?.jsonPrimitive?.content?.let { LocalDateTime.parse(it).atZone(codexZone).toInstant().toEpochMilli() }
            val agents = List(chat.nullable("agents")?.jsonPrimitive?.int ?: 0) { LiveAgent("a$it") }
            val live = LiveChat(
                "c",
                running = chat.nullable("running")?.jsonPrimitive?.booleanOrNull == true,
                pending = chat.nullable("pending")?.jsonPrimitive?.int ?: 0,
                status = chat.nullable("status")?.jsonPrimitive?.content ?: "",
                failed = chat.nullable("failed")?.jsonPrimitive?.booleanOrNull == true,
                stalled = chat.nullable("stalled")?.jsonPrimitive?.booleanOrNull == true,
                agentList = agents,
                run = run?.let { LiveRun("r", state = it.str("state"), why = it.nullable("why")?.jsonPrimitive?.content, nextAt = nextAt) },
            )
            val e = c.getValue("expected").jsonObject
            val got = statusLine(live, null)
            assertEquals(c.str("name"), e.str("text") to e.str("tone"), got.text to got.tone.name.lowercase())
        }
    }

    @Test fun appCounts() {
        for (c in cases("counts")) {
            val seen = c.nullable("seen")?.jsonObject?.mapValues { it.value.jsonPrimitive.long } ?: emptyMap()
            val chats = c.getValue("chats").jsonArray.map { countChat(it.decode<LiveChat>(), seen) }
            val mcp = c.nullable("mcp")?.jsonArray?.map { McpServer(it.jsonObject.str("name"), it.jsonObject.str("status")) } ?: emptyList()
            val hidden = c.nullable("hidden")?.jsonObject?.mapValues { it.value.jsonPrimitive.content } ?: emptyMap()
            val got = appCounts(chats, c.str("viewing"), c.nullable("attention")?.jsonPrimitive?.int ?: 0, mcp, hidden, c.nullable("needsYouRows")?.jsonPrimitive?.int ?: 0, c.nullable("replyRows")?.jsonPrimitive?.int ?: 0)
            val e = c.getValue("expected").jsonObject
            val m = e.getValue("mcp").jsonObject
            val want = listOf("needsYou", "chats", "waiting", "running", "agents").map { e.getValue(it).jsonPrimitive.int } + listOf("connected", "total", "needsYou").map { m.getValue(it).jsonPrimitive.int }
            assertEquals(c.str("name"), want, listOf(got.needsYou, got.chats, got.waiting, got.running, got.agents, got.mcp.connected, got.mcp.total, got.mcp.needsYou))
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

    @Test fun buildPromptText() {
        for (c in cases("build-prompt")) assertEquals(c.str("name"), c.str("expected"), buildPrompt(c.str("brief")))
    }

    @Test fun specOpenTasks() {
        for (c in cases("spec-open-tasks")) assertEquals(c.str("name"), c.str("expected"), withoutOpenTasks(c.str("md")))
    }

    @Test fun specSlug() {
        for (c in cases("spec-slug")) assertEquals(c.str("name"), c.str("slug"), specSlug(c.str("path")))
    }

    @Test fun sketchPath() {
        for (c in cases("sketch-path")) assertEquals(c.str("name"), c.getValue("sketch").jsonPrimitive.booleanOrNull, isSketchPath(c.str("path")))
    }

    @Test fun sketchDoc() {
        for (c in cases("sketch-doc")) assertEquals(c.str("name"), c.str("doc"), sketchDoc(c.str("html"), c.str("theme")))
    }

    @Test fun goalCommand() {
        for (c in cases("goal-command")) {
            c["command"]?.let {
                val f = c.getValue("form").jsonObject
                val form = GoalForm(f.str("what"), f.getValue("every").jsonPrimitive.long, f.nullable("stopIn")?.jsonPrimitive?.long, f.nullable("stopAt")?.jsonPrimitive?.content, f.nullable("capPct")?.jsonPrimitive?.int)
                assertEquals(c.str("name"), it.jsonPrimitive.content, goalCommand(form, c.getValue("now").jsonPrimitive.long))
            }
            c["condition"]?.let { assertEquals(c.str("name"), it.jsonPrimitive.content, planCondition(c.str("path"), c.str("md"))) }
            if ("plan" in c) assertEquals(c.str("name"), c.nullable("plan")?.jsonPrimitive?.content, planOf(c.str("what")))
            if ("every" in c) assertEquals(c.str("name"), c.nullable("ms")?.jsonPrimitive?.long, parseEvery(c.str("every")))
        }
    }

    @Test fun appendRule() {
        for (c in cases("append-rule")) assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, appendRule(c.str("text"), c.str("rule")))
    }

    @Test fun eventRule() {
        for (c in cases("event-rule")) {
            val f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as JsonElement }.toMutableMap()
            f["people"] = toJson(c.str("people"))
            c.nullable("links")?.let { f["links"] = toJson(it.jsonPrimitive.content) }
            assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.boolean, isEvent(Row("meetings", c.str("id"), "work", f = f)))
        }
    }

    private fun JsonObject.prim(k: String) = nullable(k)?.jsonPrimitive

    private val meetingCases get() = Json.parseToJsonElement(File("../../shared/fixtures/meetings.json").readText()).jsonObject

    private fun specMeeting(m: JsonObject, now: Long): Row {
        val f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as JsonElement }.toMutableMap()
        m.prim("title")?.let { f["title"] = it }
        m.prim("startsInHours")?.let { f["starts_at"] = toJson(now + it.long * 3_600_000) }
        m.prim("endsInHours")?.let { f["ends_at"] = toJson(now + it.long * 3_600_000) }
        for ((field, key) in listOf("people" to "people", "transcript" to "transcript", "summary" to "summary", "state" to "state")) m.prim(key)?.let { f[field] = it }
        m.prim("organizerMe")?.let { f["organizer_me"] = it }
        return Row("meetings", m.str("id"), m.prim("profile")?.content ?: "work", deleted = m.prim("deleted")?.boolean == true, f = f)
    }

    private fun specItem(r: JsonObject): Row {
        val f = SYNCED_FIELDS.getValue("items").associateWith { JsonNull as JsonElement }.toMutableMap()
        f["meeting_id"] = toJson(r.str("meeting"))
        f["status"] = toJson(r.str("status"))
        r.prim("assignee")?.let { f["assignee"] = it }
        return Row("items", "i", r.prim("profile")?.content ?: "work", deleted = r.prim("deleted")?.boolean == true, f = f)
    }

    @Test fun meetingStates() {
        val now = 1_800_000_000_000
        for (c in meetingCases.getValue("state").jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("name"), c.str("expected"), meetingState(specMeeting(c.getValue("meeting").jsonObject, now), now).name.lowercase())
        }
    }

    @Test fun meetingGroups() {
        val now = 1_800_000_000_000
        for (c in meetingCases.getValue("groups").jsonArray.map { it.jsonObject }) {
            val groups = groupMeetings(c.getValue("meetings").jsonArray.map { specMeeting(it.jsonObject, now) }, now)
            val expected = c.getValue("expected").jsonArray.map { it.jsonObject }
            assertEquals(c.str("name"), expected.map { it.getValue("today").jsonPrimitive.boolean to it.getValue("ids").jsonArray.map { id -> id.jsonPrimitive.content } }, groups.map { (it.label == "Today") to it.rows.map { m -> m.id } })
        }
    }

    @Test fun meetingSeriesTitles() {
        for (c in meetingCases.getValue("seriesTitle").jsonArray.map { it.jsonObject }) assertEquals(c.str("name"), c.str("expected"), seriesTitle(c.prim("title")?.content))
    }

    @Test fun meetingsInSeries() {
        val now = 1_800_000_000_000
        for (c in meetingCases.getValue("inSeries").jsonArray.map { it.jsonObject }) {
            val meetings = c.getValue("meetings").jsonArray.map { specMeeting(it.jsonObject, now) }
            val keys = inSeries(meetings)
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, meetings.filter { it.key in keys }.map { it.id })
        }
    }

    @Test fun personNames() {
        for (c in meetingCases.getValue("names").jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("name"), c.str("display"), displayName(c.str("a")))
            assertEquals(c.str("name"), c.getValue("same").jsonPrimitive.boolean, sameName(c.str("a"), c.str("b")))
        }
    }

    @Test fun meetingActionCounts() {
        val meeting = Row("meetings", "cal:a", "work")
        for (c in meetingCases.getValue("actionCount").jsonArray.map { it.jsonObject }) {
            val n = actionCount(c.getValue("items").jsonArray.map { specItem(it.jsonObject) }, meeting)
            val expected = c.getValue("expected").jsonObject.mapValues { it.value.jsonPrimitive.int }
            assertEquals(c.str("name"), expected, mapOf("total" to n.total, "done" to n.done, "review" to n.review, "unassigned" to n.unassigned, "dismissed" to n.dismissed))
        }
    }

    @Test fun meetingFilters() {
        val now = 1_800_000_000_000
        val filter = meetingCases.getValue("filter").jsonObject
        val meetings = filter.getValue("meetings").jsonArray.map { specMeeting(it.jsonObject, now) }
        val items = filter.getValue("items").jsonArray.map { specItem(it.jsonObject) }
        for (c in filter.getValue("cases").jsonArray.map { it.jsonObject }) {
            val chips = c.getValue("chips").jsonArray.map { it.jsonPrimitive.content }.toSet()
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, filterMeetings(meetings, items, chips, now).map { it.id })
        }
    }

    @Test fun revertBlock() {
        for (c in cases("revert-block")) assertEquals(c.str("name"), c.str("expected"), revertBlock(fileDiff(c.str("original"), c.str("content")), c.getValue("block").jsonPrimitive.int))
    }

    @Test fun specPrompt() {
        for (c in cases("spec-prompt")) assertEquals(c.str("name"), c.str("expected"), specPrompt(c.str("request")))
    }

    @Test fun setupPrompt() {
        for (c in cases("setup-prompts")) assertEquals(c.str("name"), c.str("expected"), setupPrompt(c.str("kind"), c.str("repo"), c.str("mcpCommand")))
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

    @Test fun menuModesCases() {
        for (c in cases("menu-modes")) {
            val m = menuModes(c.nullable("provider")?.jsonPrimitive?.content, c.str("mode"), c.getValue("review").jsonPrimitive.boolean)
            assertEquals(c.str("name"), c.getValue("list").jsonArray.map { it.jsonPrimitive.content }, m.list.map { it.value })
            assertEquals(c.str("name"), c.str("checked"), m.checked)
            assertEquals(c.str("name"), c.str("label"), m.label)
        }
    }

    @Test fun newestModelsCases() {
        for (c in cases("newest-models")) {
            val models = c.getValue("models").jsonArray.map { ModelInfo(it.jsonPrimitive.content, it.jsonPrimitive.content) }
            val shown = newestModels(models, c.nullable("current")?.jsonPrimitive?.content).map { it.value }
            assertEquals(c.str("name"), c.getValue("shown").jsonArray.map { it.jsonPrimitive.content }, shown)
        }
    }

    @Test fun modeStepsCases() {
        for (c in cases("mode-steps")) {
            val (mode, review) = modeSteps(c.str("mode"), c.getValue("review").jsonPrimitive.boolean, c.str("picked"))
            val send = c.getValue("send").jsonObject
            assertEquals(c.str("name"), send.nullable("mode")?.jsonPrimitive?.content, mode)
            assertEquals(c.str("name"), send.nullable("review")?.jsonPrimitive?.boolean, review)
        }
    }

    @Test fun moneyByBilling() {
        for (c in cases("money")) assertEquals(c.str("name"), c.str("expected"), money(c.getValue("n").jsonPrimitive.content.toDouble(), c.str("billing")))
    }

    @Test fun bottomBar() {
        for (c in cases("bottom-bar")) {
            val events = c.getValue("events").jsonArray.map { e -> BarEvent.valueOf(e.jsonPrimitive.content.replaceFirstChar { it.uppercase() }) }
            val hidden = events.runningFold(BarState(), ::barState).drop(1).map(::barHidden)
            assertEquals(c.str("name"), c.getValue("hidden").jsonArray.map { it.jsonPrimitive.boolean }, hidden)
        }
    }

    @Test fun featureUse() {
        val fixture = Json.parseToJsonElement(File("../../shared/fixtures/feature-use.json").readText()).jsonObject
        assertEquals(fixture.getValue("ids").jsonArray.map { it.jsonPrimitive.content }, FEATURES.map { it.id })
        assertEquals(fixture.getValue("hideable").jsonArray.map { it.jsonPrimitive.content }, FEATURES.filter { it.hideable }.map { it.id })
        for (c in fixture.getValue("shown").jsonArray.map { it.jsonObject }) {
            val hidden = c.getValue("hidden").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.str("id"), c.getValue("expected").jsonPrimitive.boolean, shownFeature(c.str("id"), hidden))
        }
        for (c in fixture.getValue("rows").jsonArray.map { it.jsonObject }) {
            val days = c.getValue("days").jsonObject.mapValues { (_, v) -> v.jsonObject.mapValues { it.value.jsonPrimitive.int } }
            val rows = featureRows(days, c.str("today"), c.getValue("window").jsonPrimitive.int)
            assertEquals(c.str("name"), c.getValue("never").jsonArray.map { it.jsonPrimitive.content }, rows.never.map { it.id })
            val used = rows.used.map { listOf(it.feature.id, it.n7, it.n30, it.last) }
            assertEquals(c.str("name"), c.getValue("used").jsonArray.map { u -> u.jsonArray.let { listOf(it[0].jsonPrimitive.content, it[1].jsonPrimitive.int, it[2].jsonPrimitive.int, it[3].jsonPrimitive.content) } }, used)
        }
    }
}

package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.codex.meetings.isEvent
import no.pradhan.agentview.nativeapp.codex.meetings.markSegments
import no.pradhan.agentview.nativeapp.codex.meetings.matchLabel
import no.pradhan.agentview.nativeapp.codex.meetings.notesTemplateCaret
import no.pradhan.agentview.nativeapp.codex.meetings.notesTemplateChips
import no.pradhan.agentview.nativeapp.codex.meetings.notesTemplateText
import no.pradhan.agentview.nativeapp.codex.meetings.stepMatch
import java.io.File
import java.io.IOException
import no.pradhan.agentview.nativeapp.net.ApiError
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.long
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.app.chatNotice
import no.pradhan.agentview.nativeapp.app.BarEvent
import no.pradhan.agentview.nativeapp.app.SeenMark
import no.pradhan.agentview.nativeapp.app.mergeSeen
import no.pradhan.agentview.nativeapp.chat.Use
import no.pradhan.agentview.nativeapp.chat.addUse
import no.pradhan.agentview.nativeapp.chat.attachMark
import no.pradhan.agentview.nativeapp.chat.buildHistory
import no.pradhan.agentview.nativeapp.chat.composerPlaceholder
import no.pradhan.agentview.nativeapp.chat.ghostFor
import no.pradhan.agentview.nativeapp.chat.withUses
import no.pradhan.agentview.nativeapp.chat.findInChat
import no.pradhan.agentview.nativeapp.chat.findStart
import no.pradhan.agentview.nativeapp.sessions.SavedSession
import no.pradhan.agentview.nativeapp.sessions.chatMatches
import no.pradhan.agentview.nativeapp.sessions.queryWords
import no.pradhan.agentview.nativeapp.sessions.since
import no.pradhan.agentview.nativeapp.chat.failedLine
import no.pradhan.agentview.nativeapp.chat.mergeTail
import no.pradhan.agentview.nativeapp.chat.trimHeld
import no.pradhan.agentview.nativeapp.chat.turnEnd
import no.pradhan.agentview.nativeapp.chat.rememberPrompt
import no.pradhan.agentview.nativeapp.chat.turnAnswers
import no.pradhan.agentview.nativeapp.chat.proposalState
import no.pradhan.agentview.nativeapp.chat.usedClaimState
import no.pradhan.agentview.nativeapp.chat.shortModel
import no.pradhan.agentview.nativeapp.chat.startModeFor
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
import no.pradhan.agentview.nativeapp.chat.exploreLabelOf
import no.pradhan.agentview.nativeapp.chat.exploreRunsOf
import no.pradhan.agentview.nativeapp.chat.FoldRow
import no.pradhan.agentview.nativeapp.chat.Proposal
import no.pradhan.agentview.nativeapp.chat.StatusStep
import no.pradhan.agentview.nativeapp.chat.buildTranscript
import no.pradhan.agentview.nativeapp.chat.foldTurns
import no.pradhan.agentview.nativeapp.chat.WorkTitle
import no.pradhan.agentview.nativeapp.chat.workTitle
import no.pradhan.agentview.nativeapp.chat.chatMarkdown
import no.pradhan.agentview.nativeapp.chat.draftKey
import no.pradhan.agentview.nativeapp.chat.handoffText
import no.pradhan.agentview.nativeapp.chat.LimitResume
import no.pradhan.agentview.nativeapp.chat.limitResume
import no.pradhan.agentview.nativeapp.chat.lastReply
import no.pradhan.agentview.nativeapp.chat.joinMarks
import no.pradhan.agentview.nativeapp.chat.markLabel
import no.pradhan.agentview.nativeapp.chat.splitMarks
import no.pradhan.agentview.nativeapp.chat.Part
import no.pradhan.agentview.nativeapp.chat.userParts
import no.pradhan.agentview.nativeapp.chat.latestChecklist
import no.pradhan.agentview.nativeapp.chat.reviewLabel
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.chat.statusLine
import no.pradhan.agentview.nativeapp.chat.stripRound
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalForm
import no.pradhan.agentview.nativeapp.codex.autopilot.goalEnd
import no.pradhan.agentview.nativeapp.codex.autopilot.runDetail
import no.pradhan.agentview.nativeapp.codex.autopilot.TryColumn
import no.pradhan.agentview.nativeapp.codex.autopilot.addPreset
import no.pradhan.agentview.nativeapp.codex.autopilot.goalCommand
import no.pradhan.agentview.nativeapp.codex.autopilot.parsePresets
import no.pradhan.agentview.nativeapp.codex.autopilot.rerunForm
import no.pradhan.agentview.nativeapp.codex.autopilot.removePreset
import no.pradhan.agentview.nativeapp.codex.autopilot.parseEvery
import no.pradhan.agentview.nativeapp.codex.autopilot.planOf
import no.pradhan.agentview.nativeapp.codex.autopilot.finishedLine
import no.pradhan.agentview.nativeapp.codex.autopilot.runLine
import no.pradhan.agentview.nativeapp.codex.autopilot.buildsLine
import no.pradhan.agentview.nativeapp.sessions.Repo
import no.pradhan.agentview.nativeapp.sessions.Workspace
import no.pradhan.agentview.nativeapp.sessions.Worktree
import no.pradhan.agentview.nativeapp.sessions.chatPlace
import no.pradhan.agentview.nativeapp.sessions.heldOrder
import no.pradhan.agentview.nativeapp.sessions.advisorLoopLine
import no.pradhan.agentview.nativeapp.sessions.advisorLoopOf
import no.pradhan.agentview.nativeapp.codex.autopilot.mergeQuiet
import no.pradhan.agentview.nativeapp.codex.autopilot.stoppedText
import no.pradhan.agentview.nativeapp.codex.autopilot.tryColumn
import no.pradhan.agentview.nativeapp.chat.BuildEntry
import no.pradhan.agentview.nativeapp.chat.SpecHomeItem
import no.pradhan.agentview.nativeapp.chat.specHomeOrder
import no.pradhan.agentview.nativeapp.chat.specRowParts
import no.pradhan.agentview.nativeapp.sessions.BacklogItem
import no.pradhan.agentview.nativeapp.sessions.advisorBoard
import no.pradhan.agentview.nativeapp.sessions.specItemPrompt
import no.pradhan.agentview.nativeapp.sessions.AuditFinding
import no.pradhan.agentview.nativeapp.sessions.auditCountLine
import no.pradhan.agentview.nativeapp.sessions.defaultAdvisorRoot
import no.pradhan.agentview.nativeapp.chat.buildTotals
import no.pradhan.agentview.nativeapp.chat.withoutCriteria
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
import no.pradhan.agentview.nativeapp.ui.agoShort
import no.pradhan.agentview.nativeapp.workspace.fileDiff
import no.pradhan.agentview.nativeapp.workspace.revertBlock
import no.pradhan.agentview.nativeapp.codex.wiki.claimActions
import no.pradhan.agentview.nativeapp.codex.wiki.editedClaimText
import no.pradhan.agentview.nativeapp.codex.wiki.givenPreferences
import no.pradhan.agentview.nativeapp.codex.wiki.hasLiveClaims
import no.pradhan.agentview.nativeapp.codex.wiki.isOld
import no.pradhan.agentview.nativeapp.codex.wiki.pageClaims
import no.pradhan.agentview.nativeapp.codex.wiki.staleFacts
import no.pradhan.agentview.nativeapp.codex.wiki.wikiMarkdown
import kotlinx.serialization.json.buildJsonArray
import no.pradhan.agentview.nativeapp.codex.wiki.reviewQueue
import no.pradhan.agentview.nativeapp.codex.wiki.replaceTarget
import no.pradhan.agentview.nativeapp.codex.wiki.restatedClaim
import no.pradhan.agentview.nativeapp.codex.wiki.similarClaim
import no.pradhan.agentview.nativeapp.chat.appendRule
import no.pradhan.agentview.nativeapp.chat.can
import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.net.menuModes
import no.pradhan.agentview.nativeapp.net.modeSteps
import no.pradhan.agentview.nativeapp.net.providerMark
import no.pradhan.agentview.nativeapp.net.providerModes
import no.pradhan.agentview.nativeapp.codex.jobs.failedJobs
import no.pradhan.agentview.nativeapp.codex.jobs.heldUntil
import no.pradhan.agentview.nativeapp.codex.jobs.WEEKLY_DIGEST
import no.pradhan.agentview.nativeapp.codex.jobs.jobEdits
import no.pradhan.agentview.nativeapp.codex.jobs.newJob
import no.pradhan.agentview.nativeapp.codex.jobs.parseSchedule
import no.pradhan.agentview.nativeapp.codex.jobs.scheduleOf
import no.pradhan.agentview.nativeapp.codex.jobs.money
import no.pradhan.agentview.nativeapp.codex.jobs.tasksOf
import no.pradhan.agentview.nativeapp.codex.meetings.actionCount
import no.pradhan.agentview.nativeapp.codex.meetings.agendaMarkdown
import no.pradhan.agentview.nativeapp.codex.meetings.draftFor
import no.pradhan.agentview.nativeapp.codex.meetings.displayName
import no.pradhan.agentview.nativeapp.codex.meetings.filterMeetings
import no.pradhan.agentview.nativeapp.codex.meetings.followUpText
import no.pradhan.agentview.nativeapp.codex.meetings.hasContent
import no.pradhan.agentview.nativeapp.codex.meetings.meetingMarkdown
import no.pradhan.agentview.nativeapp.codex.meetings.groupMeetings
import no.pradhan.agentview.nativeapp.codex.meetings.inSeries
import no.pradhan.agentview.nativeapp.codex.meetings.meetingState
import no.pradhan.agentview.nativeapp.codex.meetings.isLate
import no.pradhan.agentview.nativeapp.codex.meetings.sameName
import no.pradhan.agentview.nativeapp.codex.meetings.seriesTitle
import no.pradhan.agentview.nativeapp.ops.McpServer
import no.pradhan.agentview.nativeapp.ops.setupPrompt
import no.pradhan.agentview.nativeapp.workspace.isSketchPath
import no.pradhan.agentview.nativeapp.workspace.isSpecPath
import no.pradhan.agentview.nativeapp.workspace.sketchDoc
import no.pradhan.agentview.nativeapp.workspace.planCondition
import no.pradhan.agentview.nativeapp.chat.buildPrompt
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

// The cases in shared/fixtures also run in web/src/sharedCases.test.ts, so a case added there is checked against both implementations.
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

    @Test fun chatMenu() {
        val fixture = Json.parseToJsonElement(File("../../shared/fixtures/chat-menu.json").readText()).jsonObject
        for (c in fixture.getValue("review").jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("name"), c.str("expected"), reviewLabel(c.getValue("running").jsonPrimitive.boolean, c.getValue("hasChanges").jsonPrimitive.boolean))
        }
    }

    @Test fun chatNotices() {
        val base = buildJsonObject { put("id", "a"); put("title", "Fix tests"); put("cwd", "/Users/me/agentview/") }
        for (c in cases("chat-notices")) {
            val before = JsonObject(base + c.getValue("before").jsonObject).decode<LiveChat>()
            val now = JsonObject(base + c.getValue("now").jsonObject).decode<LiveChat>()
            val n = chatNotice(before, now, c.getValue("muted").jsonPrimitive.boolean)
            val actual = n?.let { buildJsonObject { put("kind", it.kind.name.lowercase()); put("title", it.title); put("body", it.body); if (it.sub.isNotEmpty()) put("sub", it.sub) } } ?: JsonNull
            assertEquals(c.str("name"), c.getValue("expected"), actual)
        }
    }

    @Test fun editCount() {
        for (c in cases("edit-count")) {
            val expected = c["expected"]?.takeIf { it !is JsonNull }?.jsonObject?.let { it.getValue("add").jsonPrimitive.long.toInt() to it.getValue("del").jsonPrimitive.long.toInt() }
            assertEquals(c.str("name"), expected, editCount(c.str("tool"), c.getValue("input").jsonObject))
        }
    }

    @Test fun exploreRuns() {
        for (c in cases("explore-runs")) {
            val rows = c.getValue("rows").jsonArray.map { it.jsonObject }
            val runs = exploreRunsOf(rows.map { r -> r["name"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content to r.getValue("ok").jsonPrimitive.boolean })
            assertEquals(c.str("name"), c.getValue("runs").jsonArray.map { it.jsonObject.let { r -> r.getValue("start").jsonPrimitive.int until r.getValue("end").jsonPrimitive.int } }, runs)
            assertEquals(c.str("name"), c.getValue("labels").jsonArray.map { it.jsonPrimitive.content }, runs.map { r -> exploreLabelOf(rows.slice(r).map { it.str("name") }) })
        }
    }

    @Test fun workFold() {
        for (c in cases("work-fold")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            val rows = foldTurns(buildTranscript(events), events)
            assertEquals(c.str("name"), c.getValue("rows").jsonArray.map { it.jsonPrimitive.content }, rows.map { it.key })
            val titles = rows.filterIsInstance<FoldRow.Fold>().map { workTitle(it.work, false, c.str("billing")) }
            assertEquals(c.str("name"), c.getValue("titles").jsonArray.map { it.jsonObject.let { t -> WorkTitle(t.str("text"), t.str("failed"), t.str("detail")) } }, titles)
            c["steps"]?.let { expected ->
                val want = expected.jsonArray.map { turn -> turn.jsonArray.map { s -> s.jsonObject.let { StatusStep(it.str("id"), it.str("title"), it["done"]?.jsonPrimitive?.boolean == true) } } }
                assertEquals(c.str("name"), want, rows.filterIsInstance<FoldRow.Fold>().map { it.steps })
            }
            c["proposed"]?.let { expected ->
                val want = expected.jsonArray.map { turn -> turn.jsonArray.map { p -> p.jsonObject.let { Proposal(it.str("id"), it.str("text")) } } }
                assertEquals(c.str("name"), want, rows.filterIsInstance<FoldRow.Fold>().map { it.proposed })
            }
            c["now"]?.let { expected -> assertEquals(c.str("name"), expected.jsonArray.map { it.jsonPrimitive.content }, rows.filterIsInstance<FoldRow.Fold>().map { it.now }) }
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

    @Test fun trimHeld() {
        fun events(c: JsonObject, k: String) = c.getValue(k).jsonArray.map { ChatEvent(id = it.jsonPrimitive.content, kind = "user") }
        for (c in cases("trim-held")) {
            val (kept, earlier) = trimHeld(events(c, "events"), c.getValue("earlier").jsonPrimitive.int, c.getValue("max").jsonPrimitive.int, c.getValue("keep").jsonPrimitive.int)
            assertEquals(c.str("name"), events(c, "expected").map { it.id }, kept.map { it.id })
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

    @Test fun hubRetryWaits() {
        for (c in cases("hub-retry")) {
            val status = c.nullable("status")?.jsonPrimitive?.int
            val error = when (status) { null -> IllegalStateException("rejected"); 0 -> IOException("timeout"); else -> ApiError("failed", status) }
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.long, hubRetry(c.getValue("failures").jsonPrimitive.int, error))
        }
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

    @Test fun attachments() {
        for (c in cases("attachments")) {
            val s = splitMarks(c.str("text"))
            assertEquals(c.str("name"), c.str("body"), s.body)
            assertEquals(c.str("name"), c.getValue("marks").jsonArray.map { it.jsonPrimitive.content }, s.marks)
            assertEquals(c.str("name"), c.getValue("names").jsonArray.map { it.jsonPrimitive.content }, s.marks.map { markLabel(it) })
            assertEquals(c.str("name"), c.str("joined"), joinMarks(s.body, s.marks))
        }
    }

    @Test fun userParts() {
        for (c in cases("user-parts")) {
            val expected = c.getValue("parts").jsonArray.map {
                val p = it.jsonObject
                p["image"]?.let { i -> Part.Image(i.jsonPrimitive.content) } ?: Part.Text(p.str("text"))
            }
            assertEquals(c.str("name"), expected, userParts(c.str("text")))
        }
    }

    @Test fun chatMarkdown() {
        for (c in cases("chat-markdown")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            assertEquals(c.str("name"), c.str("markdown"), chatMarkdown(c.str("title"), events))
            assertEquals(c.str("name"), c.nullable("lastReply")?.jsonPrimitive?.content, lastReply(events))
        }
    }

    @Test fun limitResume() {
        for (c in cases("limit-resume")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            val expected = c["expected"]?.takeIf { it !is JsonNull }?.jsonObject?.let { LimitResume(it.str("prompt"), it.getValue("reset").jsonPrimitive.long) }
            assertEquals(c.str("name"), expected, limitResume(events))
        }
    }

    @Test fun handoffText() {
        for (c in cases("handoff-text")) assertEquals(c.str("name"), c.str("expected"), handoffText(c.str("sessionId")))
    }

    @Test fun draftKey() {
        for (c in cases("draft-key")) assertEquals(c.str("name"), c.str("expected"), draftKey(c.str("chat"), c.nullable("sessionId")?.jsonPrimitive?.content))
    }

    @Test fun latestChecklist() {
        for (c in cases("checklist-events")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            val expected = c.nullable("expected")?.jsonArray?.map { ChecklistItem(it.jsonObject.str("content"), it.jsonObject.str("activeForm"), it.jsonObject.str("status")) }
            assertEquals(c.str("name"), expected, latestChecklist(events))
        }
    }

    @Test fun finishedLine() {
        for (c in cases("finished-line")) {
            val endedAt = c.nullable("endedAt")?.jsonPrimitive?.long
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, finishedLine(c.str("why"), endedAt) { "${it}h ago" })
        }
    }

    @Test fun startMode() {
        for (c in cases("start-mode")) {
            val mode = c.nullable("mode")?.jsonPrimitive?.content
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, startModeFor(mode, c.nullable("provider")?.jsonPrimitive?.content))
        }
    }

    @Test fun chatPlaces() {
        val world = Json.parseToJsonElement(File("../../shared/fixtures/chat-place.json").readText()).jsonObject
        val ws = Workspace(
            repos = world.getValue("repos").jsonArray.map { Repo(it.jsonObject.str("name"), it.jsonObject.str("cwd")) },
            trees = world.getValue("trees").jsonArray.map { Worktree(repo = it.jsonObject.str("repo"), cwd = it.jsonObject.str("cwd"), name = it.jsonObject.str("name")) },
        )
        for (c in world.getValue("cases").jsonArray.map { it.jsonObject }) assertEquals(c.str("name"), c.str("expected"), chatPlace(ws, c.str("cwd")))
    }

    @Test fun shortModelNames() {
        for (c in cases("short-model")) assertEquals(c.str("name"), c.str("expected"), shortModel(c.str("model")))
    }

    @Test fun goalEnd() {
        for (c in cases("goal-end")) assertEquals(c.str("name"), c.str("expected"), goalEnd(c.str("why")))
    }

    @Test fun runDetail() {
        for (c in cases("run-detail")) {
            val d = runDetail(ChatRun(id = "r", kind = c.str("kind"), state = c.str("state")))
            val e = c.getValue("expected").jsonObject
            assertEquals(c.str("name"), listOf(e.str("heading"), e.str("what"), e.getValue("editable").jsonPrimitive.boolean, e.getValue("opens").jsonPrimitive.boolean), listOf(d.heading, d.what, d.editable, d.opens))
        }
    }

    @Test fun rerunForm() {
        for (c in cases("rerun-form")) {
            val run = JsonObject(mapOf("id" to toJson("r")) + c.getValue("run").jsonObject).decode<ChatRun>()
            val f = c.getValue("form").jsonObject
            val got = rerunForm(run)
            val name = c.str("name")
            assertEquals(name, f.str("what"), got.form.what)
            assertEquals(name, f.getValue("every").jsonPrimitive.long, got.form.every)
            assertEquals(name, f.nullable("stopIn")?.jsonPrimitive?.long, got.form.stopIn)
            assertEquals(name, f.nullable("stopAt")?.jsonPrimitive?.content, got.form.stopAt)
            assertEquals(name, f.nullable("capPct")?.jsonPrimitive?.int, got.form.capPct)
            assertEquals(name, f.nullable("capUsd")?.jsonPrimitive?.int, got.form.capUsd)
            assertEquals(name, f.nullable("builds")?.jsonPrimitive?.int, got.form.builds)
            assertEquals(name, f.nullable("plan")?.jsonPrimitive?.content, got.plan)
        }
    }

    @Test fun runLine() {
        for (c in cases("run-line")) {
            val run = JsonObject(mapOf("id" to toJson("r")) + c.getValue("run").jsonObject).decode<ChatRun>()
            assertEquals(c.str("name"), c.str("expected"), runLine(run))
        }
    }

    @Test fun advisorLoop() {
        for (c in cases("advisor-loop")) {
            val runs = c.getValue("runs").jsonArray.map { JsonObject(mapOf("id" to toJson("r")) + it.jsonObject).decode<ChatRun>() }
            val found = advisorLoopOf(runs, c.str("root"))
            val expected = c.nullable("expected")?.jsonObject
            assertEquals(c.str("name"), expected?.let { Triple(it.str("id"), it.str("line"), it.prim("builds")?.content ?: "") }, found?.let { Triple(it.id, advisorLoopLine(it), buildsLine(it)) })
        }
    }

    @Test fun advisorRoot() {
        for (c in cases("advisor-root")) {
            val repos = c.getValue("repos").jsonArray.map { it.jsonObject.str("cwd") to it.jsonObject.getValue("last").jsonPrimitive.long }
            val open = c.nullable("open")?.jsonPrimitive?.content
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, defaultAdvisorRoot(open, repos))
        }
    }

    @Test fun auditCount() {
        for (c in cases("audit-count")) {
            val findings = c.getValue("statuses").jsonArray.mapIndexed { i, s -> AuditFinding(i + 1, "", "", "low", "", status = s.jsonPrimitive.content) }
            assertEquals(c.str("name"), c.str("expected"), auditCountLine(findings))
        }
    }

    @Test fun advisorBoard() {
        for (c in cases("advisor-board")) {
            val backlog = c.getValue("backlog").jsonArray.map { it.decode<BacklogItem>() }
            val specs = c.getValue("specs").jsonArray.map { it.decode<SpecHomeItem>() }
            val board = advisorBoard(backlog, specs, c.getValue("loopNeedsYou").jsonPrimitive.boolean)
            val expected = c.getValue("expected").jsonObject
            for (stage in listOf("ideas", "specced", "building", "done")) {
                val want = expected.getValue(stage).jsonArray.map { val o = it.jsonObject; Triple(o.str("slug"), o.nullable("action")?.jsonPrimitive?.content, o.getValue("needsYou").jsonPrimitive.boolean) }
                assertEquals("${c.str("name")}: $stage", want, board.stages.getValue(stage).map { Triple(it.slug, it.action, it.needsYou) })
            }
            assertEquals(c.str("name"), expected.str("defaultStage"), board.defaultStage)
        }
    }

    @Test fun specItemPrompt() {
        for (c in cases("spec-item-prompt")) assertEquals(c.str("name"), c.str("expected"), specItemPrompt(c.str("root"), c.getValue("item").decode<BacklogItem>()))
    }

    @Test fun taskChatPrompt() {
        for (c in cases("task-chat-prompt")) {
            val t = c.getValue("task").jsonObject
            assertEquals(c.str("name"), c.str("expected"), taskChatPrompt(t.nullable("id")?.jsonPrimitive?.content, t.nullable("status")?.jsonPrimitive?.content, t.nullable("title")?.jsonPrimitive?.content, t.nullable("text")?.jsonPrimitive?.content, t.nullable("sourceUrl")?.jsonPrimitive?.content, t.nullable("sameProfile")?.jsonPrimitive?.boolean ?: false))
        }
    }

    @Test fun chatSessionOf() {
        for (c in cases("chat-session-of")) assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, chatSessionOf(c.nullable("url")?.jsonPrimitive?.content))
    }

    @Test fun mergeQuiet() {
        for (c in cases("merge-quiet")) {
            val rounds = c.getValue("rounds").jsonArray.map { it.decode<Round>() }
            val expected = c.getValue("expected").jsonArray.map { g -> g.jsonArray.map { it.jsonPrimitive.double } }
            val actual = mergeQuiet(rounds).map { listOf(it.first.n.toDouble(), it.last.n.toDouble(), it.count.toDouble(), it.costUsd) }
            assertEquals(c.str("name"), expected, actual)
        }
    }

    @Test fun stoppedText() {
        for (c in cases("stopped-text")) {
            val run = JsonObject(mapOf("id" to toJson("r")) + c.getValue("run").jsonObject).decode<ChatRun>()
            assertEquals(c.str("name"), c.str("expected"), stoppedText(run, c.getValue("working").jsonPrimitive.boolean))
        }
    }

    @Test fun turnEnd() {
        for (c in cases("turn-end")) {
            val events = c.getValue("events").jsonArray.mapIndexed { i, e -> JsonObject(mapOf("id" to toJson("e$i")) + e.jsonObject).decode<ChatEvent>() }
            assertEquals(c.str("name"), c.str("turnEnd"), turnEnd(events, c.str("label")))
            assertEquals(c.str("name"), c.getValue("failedLine").jsonPrimitive.contentOrNull, failedLine(events, c.str("label")))
        }
    }

    @Test fun promptHistory() {
        for (c in cases("prompt-history")) {
            val stored = c.getValue("stored").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, rememberPrompt(c.str("text"), stored))
        }
    }

    @Test fun withUses() {
        for (c in cases("with-uses")) {
            val picks = c.getValue("picks").jsonArray.map { Use(it.jsonObject.str("server"), it.jsonObject["tool"]?.jsonPrimitive?.content) }
            assertEquals(c.str("name"), c.str("expected"), withUses(c.str("text"), picks.fold(emptyList()) { uses, u -> addUse(uses, u) }))
        }
    }

    @Test fun ghostFor() {
        for (c in cases("ghost-for")) {
            val events = c.getValue("events").jsonArray.mapIndexed { i, e -> JsonObject(mapOf("id" to toJson("e$i")) + e.jsonObject).decode<ChatEvent>() }
            val saved = c.getValue("saved").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.str("name"), c.str("expected"), ghostFor(c.str("text"), buildHistory(events, saved)))
        }
    }

    @Test fun composerPlaceholder() {
        for (c in cases("composer-placeholder").filter { it.str("device") == "phone" }) {
            assertEquals(c.str("name"), c.str("expected"), composerPlaceholder(c.str("label"), c.str("state")))
        }
    }

    @Test fun turnAnswers() {
        for (c in cases("turn-answers")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }.toSet(), turnAnswers(buildTranscript(events), c["running"]?.jsonPrimitive?.boolean == true))
        }
    }

    @Test fun chatFind() {
        for (c in cases("chat-find")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, findInChat(events, c.str("query"), c["at"]?.jsonPrimitive?.long))
        }
    }

    @Test fun mergeSeenCases() {
        for (c in cases("merge-seen")) {
            val server = c.getValue("server").jsonObject.mapValues { it.value.jsonPrimitive.long }
            val marks = c.getValue("marks").jsonArray.map { it.jsonObject }.map { SeenMark(it.str("id"), it.getValue("value").jsonPrimitive.long, it.getValue("at").jsonPrimitive.long, it.getValue("sent").jsonPrimitive.boolean) }
            val expected = c.getValue("expected").jsonObject.mapValues { it.value.jsonPrimitive.long }
            assertEquals(c.str("name"), expected, mergeSeen(server, marks, c.getValue("startedAt").jsonPrimitive.long))
        }
    }

    @Test fun findStartCases() {
        for (c in cases("find-start")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            val hits = c.getValue("hits").jsonArray.map { it.jsonPrimitive.content }
            val at = c.getValue("at").takeIf { it !is JsonNull }?.jsonPrimitive?.long
            assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.int, findStart(events, hits, at))
        }
    }

    @Test fun chatSearchCases() {
        for (c in cases("chat-search")) {
            val saved = c.getValue("saved").takeIf { it !is JsonNull }?.jsonObject?.let { o ->
                fun opt(k: String) = o[k]?.jsonPrimitive?.content
                SavedSession("s", opt("title") ?: "", firstPrompt = opt("firstPrompt"), summary = opt("summary"), gitBranch = opt("gitBranch"))
            }
            val repo = c.getValue("repo").takeIf { it !is JsonNull }?.jsonPrimitive?.content
            assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.boolean, chatMatches(queryWords(c.str("query")), c.str("title"), saved, repo))
        }
    }

    @Test fun attachMarkCases() {
        for (c in cases("attach-mark")) assertEquals(c.str("name"), c.str("expected"), attachMark(c.str("mime"), c.str("path")))
    }

    @Test fun proposalState() {
        for (c in cases("proposal-state")) {
            val fact = (c["fact"] as? JsonObject)?.let { f -> Row("facts", "f", "work", deleted = f["deleted"]?.jsonPrimitive?.booleanOrNull == true, f = mapOf("state" to f.getValue("state"))) }
            assertEquals(c.str("name"), c.str("expected"), proposalState(fact))
        }
    }

    @Test fun usedClaimState() {
        for (c in cases("used-claim-state")) {
            val facts = c.getValue("facts").jsonArray.map { it.jsonObject }.map { o ->
                val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
                for (k in listOf("state", "superseded_by", "contested")) o[k]?.let { f[k] = it }
                Row("facts", o.str("id"), "work", deleted = o["deleted"]?.jsonPrimitive?.booleanOrNull == true, f = f)
            }
            assertEquals(c.str("name"), c.str("expected"), usedClaimState(facts, c.str("id")))
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

    @Test fun jobTasks() {
        for (c in cases("job-tasks")) {
            val job = c.getValue("job").jsonObject
            val profile = job.str("profile")
            val f = SYNCED_FIELDS.getValue("jobs").associateWith { JsonNull as JsonElement } + ("name" to job.getValue("name"))
            val items = c.getValue("items").jsonArray.map { it.jsonObject }.map { i ->
                val fields = SYNCED_FIELDS.getValue("items").associateWith { JsonNull as JsonElement } + mapOf(
                    "status" to i.getValue("status"),
                    "source" to (i["source"] ?: toJson("job")),
                    "people" to (i["people"] ?: job.getValue("name")),
                )
                Row("items", i.str("id"), i.prim("profile")?.content ?: profile, updatedAt = i.getValue("madeAt").jsonPrimitive.long, deleted = i.prim("deleted")?.boolean == true, f = fields)
            }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, tasksOf(items, Row("jobs", "j", profile, f = f)).map { it.id })
        }
    }

    @Test fun jobHeld() {
        for (c in cases("job-held")) {
            val paused = c.getValue("paused").jsonArray.map { it.jsonObject }.map { SyncPaused(it.str("scan"), it.getValue("until").jsonPrimitive.long) }
            val job = Row("jobs", "j", c.getValue("job").jsonObject.str("profile"))
            assertEquals(c.str("name"), c.prim("expected")?.long, heldUntil(job, paused, c.getValue("now").jsonPrimitive.long))
        }
    }

    @Test fun failedJobsRule() {
        fun row(table: String, o: JsonObject, fields: List<String>): Row {
            val f = SYNCED_FIELDS.getValue(table).associateWith { JsonNull as JsonElement }.toMutableMap()
            for (k in fields) o[k]?.let { f[k] = it }
            if (table == "jobs" && o["enabled"] == null) f["enabled"] = toJson(1L)
            return Row(table, o.str("id"), o.str("profile"), deleted = o["deleted"]?.jsonPrimitive?.long == 1L, f = f)
        }
        for (c in cases("failed-jobs")) {
            val jobs = c.getValue("jobs").jsonArray.map { row("jobs", it.jsonObject, listOf("enabled", "next_run_at")) }
            val runs = c.getValue("runs").jsonArray.map { row("runs", it.jsonObject, listOf("job_id", "status", "started_at", "finished_at")) }
            val expected = c.getValue("expected").jsonArray.map { it.jsonObject.str("job") to it.jsonObject.str("run") }
            assertEquals(c.str("name"), expected, failedJobs(jobs, runs, c.getValue("now").jsonPrimitive.long).map { it.job.id to it.run.id })
        }
    }

    @Test fun jobEdit() {
        for (c in cases("job-edit")) {
            val job = Row("jobs", "j", "work", f = c.getValue("job").jsonObject)
            val expected = c.getValue("expected").jsonObject.mapValues { it.value.jsonPrimitive.content }
            assertEquals(c.str("name"), expected, jobEdits(job, c.str("name_in"), c.str("prompt_in")))
        }
    }

    @Test fun newJobRule() {
        for (c in cases("new-job")) {
            val job = newJob(c.str("profile"), if (c.prim("preset") != null) WEEKLY_DIGEST else null, 1000L)
            val expected = c.getValue("expected").jsonObject
            assertEquals(c.str("name"), listOf("name", "schedule", "prompt").map { expected.str(it) } + listOf(1L, expected.str("profile")), listOf(job.str("name"), job.str("schedule"), job.str("prompt"), job.long("enabled"), job.profile))
        }
    }

    @Test fun taskSource() {
        for (c in cases("task-source")) {
            val row = Row("items", c.str("id"), "work", f = mapOf("source" to toJson(c.prim("source")?.content), "meeting_id" to toJson(c.prim("meeting_id")?.content)))
            val expected = c.getValue("expected").jsonObject
            val link = sourceLink(row)
            assertEquals(c.str("name"), listOf(expected.str("icon"), expected.str("label")), listOf(link.icon, link.label))
        }
    }

    @Test fun jobSchedule() {
        for (c in cases("job-schedule")) {
            val p = parseSchedule(c.prim("schedule")?.content)
            val name = c.str("name")
            assertEquals(name, listOf(c.str("kind"), c.str("day"), c.str("time")), listOf(p.kind, p.day, p.time))
            c.prim("written")?.let { assertEquals(name, it.content, scheduleOf(p.kind, p.day, p.time)) }
        }
    }

    @Test fun specHome() {
        for (c in cases("spec-home")) {
            val items = c.getValue("items").jsonArray.map {
                val o = it.jsonObject
                SpecHomeItem(o.str("slug"), pipeline = o.str("pipeline"), state = o.str("state"), updatedAt = o.getValue("updatedAt").jsonPrimitive.long, hold = o.getValue("hold").jsonPrimitive.boolean, waiting = o.getValue("waiting").jsonPrimitive.boolean, built = o.getValue("built").jsonPrimitive.boolean)
            }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, specHomeOrder(items).map { it.slug })
        }
    }

    @Test fun specRowParts() {
        for (c in cases("spec-row-parts")) {
            val i = SpecHomeItem("s", pipeline = c.str("pipeline"), conclusion = c.str("conclusion"), updatedAt = c.getValue("updatedAt").jsonPrimitive.long)
            val parts = specRowParts(i) { "${it}h ago" }
            assertEquals(c.str("name"), c.str("meta") to c.str("when"), parts.meta to parts.age)
        }
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
                val form = GoalForm(f.str("what"), f.getValue("every").jsonPrimitive.long, f.nullable("stopIn")?.jsonPrimitive?.long, f.nullable("stopAt")?.jsonPrimitive?.content, f.nullable("capPct")?.jsonPrimitive?.int, f.nullable("builds")?.jsonPrimitive?.int, f.nullable("capUsd")?.jsonPrimitive?.int)
                assertEquals(c.str("name"), it.jsonPrimitive.content, goalCommand(form, c.getValue("now").jsonPrimitive.long))
            }
            c["condition"]?.let { assertEquals(c.str("name"), it.jsonPrimitive.content, planCondition(c.str("path"), c.str("md"))) }
            if ("plan" in c) assertEquals(c.str("name"), c.nullable("plan")?.jsonPrimitive?.content, planOf(c.str("what")))
            if ("every" in c) assertEquals(c.str("name"), c.nullable("ms")?.jsonPrimitive?.long, parseEvery(c.str("every")))
        }
    }

    @Test fun goalPresets() {
        for (c in cases("goal-presets")) {
            val name = c.str("name")
            val list = c["list"]?.let { parsePresets(it.toString()) }.orEmpty()
            val expected = parsePresets(c.getValue("expected").toString())
            when (c.str("op")) {
                "parse" -> assertEquals(name, expected, parsePresets(c["rawText"]?.jsonPrimitive?.content ?: c.getValue("raw").toString()))
                "add" -> assertEquals(name, expected, addPreset(list, parsePresets("[${c.getValue("preset")}]").first()))
                else -> assertEquals(name, expected, removePreset(list, c.str("target")))
            }
        }
    }

    @Test fun appendRule() {
        for (c in cases("append-rule")) assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, appendRule(c.str("text"), c.str("rule")))
    }

    @Test fun heldOrder() {
        fun strings(e: JsonElement) = e.jsonArray.map { it.jsonPrimitive.content }
        for (c in cases("held-order")) assertEquals(c.str("name"), strings(c.getValue("expected")), heldOrder(c.nullable("held")?.let(::strings), strings(c.getValue("keys"))))
    }

    @Test fun dismissed() {
        val d = Json.parseToJsonElement(File("../../shared/fixtures/dismissed.json").readText()).jsonObject
        for (c in d.getValue("keys").jsonArray.map { it.jsonObject }) assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, dismissedKeys(c.prim("value")?.contentOrNull))
        for (c in d.getValue("merge").jsonArray.map { it.jsonObject }) assertEquals(c.str("name"), c.prim("expected")?.contentOrNull, mergeDismissed(c.prim("a")?.contentOrNull, c.prim("b")?.contentOrNull))
    }

    @Test fun claimAge() {
        for (c in cases("claim-age")) {
            val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
            c.nullable("state")?.let { f["state"] = toJson(it.jsonPrimitive.content) }
            c.nullable("at")?.let { f["at"] = toJson(it.jsonPrimitive.long) }
            c.nullable("used_at")?.let { f["used_at"] = toJson(it.jsonPrimitive.long) }
            assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.boolean, isOld(Row("facts", "f", "work", f = f), c.getValue("now").jsonPrimitive.long))
        }
    }

    @Test fun similarClaim() {
        for (c in cases("similar-claim")) {
            val claims = c.getValue("claims").jsonArray.map { it.jsonObject.str("id") to it.jsonObject.str("text") }
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, similarClaim(c.str("text"), claims) { it.second }?.first)
        }
    }

    @Test fun restatedClaim() {
        for (c in cases("remember")) {
            val facts = c.getValue("facts").jsonArray.map { it.jsonObject }.map { o ->
                val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
                for (k in listOf("text", "page_id", "state", "superseded_by")) o[k]?.let { f[k] = it }
                Row("facts", o.str("id"), o.str("profile"), f = f)
            }
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, restatedClaim(c.str("text"), facts, c.str("profile"))?.id)
        }
    }

    @Test fun replaceTarget() {
        for (c in cases("replace-target")) {
            val facts = c.getValue("facts").jsonArray.map { it.jsonObject }.map { o ->
                val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
                for (k in listOf("state", "superseded_by")) o[k]?.let { f[k] = it }
                Row("facts", o.str("id"), "work", deleted = o["deleted"]?.jsonPrimitive?.booleanOrNull == true, f = f)
            }
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, replaceTarget(facts, c.str("id"), "work")?.id)
        }
    }

    @Test fun givenPreferences() {
        for (c in cases("preferences")) {
            val facts = c.getValue("facts").jsonArray.map { it.jsonObject }.map { o ->
                val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
                for (k in listOf("text", "page_id", "state", "superseded_by", "contested", "at", "used_at")) o[k]?.let { f[k] = it }
                Row("facts", o.str("id"), o.str("profile"), f = f)
            }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, givenPreferences(facts, c.str("profile"), c.getValue("now").jsonPrimitive.long).map { it.id })
        }
    }

    @Test fun wikiMarkdown() {
        for (c in cases("wiki-markdown")) {
            val facts = c.getValue("claims").jsonArray.map { it.jsonObject }.mapIndexed { i, o ->
                val sources = buildJsonArray { o.getValue("sources").jsonArray.forEach { s -> add(buildJsonObject { put("kind", "doc"); put("label", s.jsonPrimitive.content) }) } }.toString()
                val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
                f["text"] = o.getValue("text"); f["heading"] = o.getValue("heading"); f["state"] = o.getValue("state"); f["at"] = o.getValue("at"); f["page_id"] = toJson("p"); f["sources"] = toJson(sources)
                Row("facts", "f$i", "work", f = f)
            }
            val groups = pageClaims(facts, "p", c.getValue("now").jsonPrimitive.long)
            assertEquals(c.str("name"), c.str("markdown"), wikiMarkdown(c.nullable("title")?.jsonPrimitive?.content, groups))
            assertEquals(c.str("name"), c.getValue("hasLive").jsonPrimitive.boolean, hasLiveClaims(groups))
        }
    }

    @Test fun claimEdit() {
        for (c in cases("claim-edit")) assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, editedClaimText(c.nullable("old")?.jsonPrimitive?.content, c.str("next")))
    }

    @Test fun cadence() {
        val c = Json.parseToJsonElement(File("../../shared/fixtures/cadence.json").readText()).jsonObject
        fun time(o: JsonObject, k: String) = o.nullable(k)?.jsonPrimitive?.content?.let { java.time.LocalDateTime.parse(it).atZone(codexZone).toInstant().toEpochMilli() }
        for (l in c.getValue("lines").jsonArray.map { it.jsonObject }) assertEquals(l.str("name"), l.str("expected"), cadenceLine(l.str("cadence"), time(l, "at"), time(l, "now")!!))
        for (r in c.getValue("reads").jsonArray.map { it.jsonObject }) assertEquals(r.str("name"), r.str("expected"), cadenceOf(r.nullable("text")?.jsonPrimitive?.content, time(r, "at"), 0L))
    }

    @Test fun staleClaims() {
        val c = Json.parseToJsonElement(File("../../shared/fixtures/stale-claims.json").readText()).jsonObject
        val now = c.getValue("now").jsonPrimitive.long
        fun rows(table: String, key: String, fill: (JsonObject, MutableMap<String, JsonElement>) -> Unit) = c.getValue(key).jsonArray.map { it.jsonObject }.map { o ->
            val f = SYNCED_FIELDS.getValue(table).associateWith { JsonNull as JsonElement }.toMutableMap()
            fill(o, f)
            Row(table, o.str("id"), "work", deleted = o["deleted"]?.jsonPrimitive?.booleanOrNull == true, f = f)
        }
        val pages = rows("pages", "pages") { o, f -> f["title"] = o.getValue("title") }
        val meetings = rows("meetings", "meetings") { o, f ->
            for (k in listOf("title", "summary", "decisions")) o[k]?.let { f[k] = it }
            f["starts_at"] = toJson(now - o.getValue("startsAgoDays").jsonPrimitive.long * DAY_MS)
        }
        val facts = rows("facts", "facts") { o, f -> for (k in listOf("page_id", "at", "used_at", "superseded_by", "state")) o[k]?.let { f[k] = it } }
        assertEquals(c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, staleFacts(facts, pages, meetings, now).map { it.id })
    }

    @Test fun claimActions() {
        for (c in cases("claim-actions")) {
            val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
            c.nullable("state")?.let { f["state"] = toJson(it.jsonPrimitive.content) }
            if (c.getValue("contested").jsonPrimitive.boolean) f["contested"] = toJson("""{"by":"a","at":1,"note":"x"}""")
            val a = claimActions(Row("facts", "f", "work", f = f), c.getValue("stale").jsonPrimitive.boolean)
            assertEquals(c.str("name"), c.getValue("buttons").jsonArray.map { it.jsonPrimitive.content }, a.buttons)
            assertEquals(c.str("name"), c.getValue("menu").jsonArray.map { it.jsonPrimitive.content }, a.menu)
        }
    }

    @Test fun actionMenu() {
        for (c in cases("action-menu")) {
            val a = no.pradhan.agentview.nativeapp.codex.meetings.actionMenu(c.str("status"))
            assertEquals(c.str("status"), listOf("notMine", "assign", "snooze").map { c.getValue(it).jsonPrimitive.boolean }, listOf(a.notMine, a.assign, a.snooze))
        }
    }

    @Test fun todayTaskMenu() {
        for (c in cases("today-menu")) assertEquals(c.str("name"), c.getValue("items").jsonArray.map { it.jsonPrimitive.content }, no.pradhan.agentview.nativeapp.codex.meetings.todayTaskMenu(c.getValue("late").jsonPrimitive.boolean))
    }

    @Test fun meetingGroupTitle() {
        for (c in cases("group-title")) assertEquals(c.str("name"), c.str("expected"), no.pradhan.agentview.nativeapp.codex.meetings.meetingGroupTitle(c.nullable("title")?.jsonPrimitive?.content, c.str("people")))
    }

    @Test fun actionGroups() {
        for (c in cases("action-groups")) {
            val rows = c.getValue("rows").jsonArray.map { it.jsonObject }.map { r ->
                val f = SYNCED_FIELDS.getValue("items").associateWith { JsonNull as JsonElement }.toMutableMap()
                r.nullable("meeting_id")?.let { f["meeting_id"] = it }
                f["source"] = r.getValue("source")
                Row("items", r.str("id"), r.str("profile"), f = f)
            }
            val got = no.pradhan.agentview.nativeapp.codex.meetings.actionGroups(rows).map { it.key to it.rows.map { r -> r.id } }
            val want = c.getValue("groups").jsonArray.map { it.jsonObject }.map { g -> g.str("key") to g.getValue("ids").jsonArray.map { it.jsonPrimitive.content } }
            assertEquals(c.str("name"), want, got)
        }
    }

    @Test fun latePromise() {
        fun at(c: JsonObject, k: String) = c.getValue(k).jsonArray.map { it.jsonPrimitive.int }.let { (y, m, d, h) -> ZonedDateTime.of(y, m, d, h, 0, 0, 0, codexZone).toInstant().toEpochMilli() }
        for (c in cases("late-promise")) assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.boolean, isLate(at(c, "since"), at(c, "now")))
    }

    @Test fun goalRisk() {
        fun at(a: JsonElement) = a.jsonArray.map { it.jsonPrimitive.int }.let { (y, m, d, h, mi) -> ZonedDateTime.of(y, m, d, h, mi, 0, 0, codexZone).toInstant().toEpochMilli() }
        for (c in cases("goal-risk")) {
            val goal = item("g", "goal")
            val tasks = c.getValue("tasks").jsonArray.mapIndexed { i, t -> t.jsonObject.let { item("t$i", it.str("status"), null, WORK, "goal" to "g", "title" to (it["title"]?.jsonPrimitive?.content ?: "x")) } }
            val busy = c.getValue("busy").jsonArray.map { it.jsonArray.let { s -> at(s[0]) to at(s[1]) } }
            val free = weekFreeMinutes(busy, at(c.getValue("now")))
            assertEquals(c.str("name"), c.getValue("free").jsonPrimitive.long, free)
            assertEquals(c.str("name"), c.getValue("risk").jsonPrimitive.boolean, goalAtRisk(tasks, goal, free))
        }
    }

    @Test fun freeSlot() {
        fun at(a: JsonElement) = a.jsonArray.map { it.jsonPrimitive.int }.let { (h, m) -> ZonedDateTime.of(2026, 10, 30, h, m, 0, 0, codexZone).toInstant().toEpochMilli() }
        fun time(k: String, c: JsonObject) = c.nullable(k)?.let(::at)
        for (c in cases("free-slot")) {
            val busy = c.getValue("busy").jsonArray.map { it.jsonArray.let { s -> at(s[0]) to at(s[1]) } }
            val now = at(c.getValue("now"))
            assertEquals(c.str("name"), time("afterNext", c), afterNextMeeting(busy, now))
            assertEquals(c.str("name"), time("freeSlot", c), nextFreeSlot(busy, now))
        }
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

    @Test fun meetingCopy() {
        for (c in cases("meeting-copy")) {
            val f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as JsonElement }.toMutableMap()
            f.putAll(c.getValue("meeting").jsonObject)
            val m = Row("meetings", "m", "work", f = f)
            val actions = c.getValue("actions").jsonArray.map { it.jsonObject }.map { Row("items", it.str("title"), "work", f = mapOf("title" to it.getValue("title"), "status" to it.getValue("status"))) }
            val name = c.str("name")
            assertEquals(name, c.getValue("hasContent").jsonPrimitive.boolean, hasContent(m, actions))
            assertEquals(name, c.str("followUp"), followUpText(m, actions))
            assertEquals(name, c.str("markdown"), meetingMarkdown(m, actions))
        }
    }

    @Test fun actionDraft() {
        for (c in cases("action-draft")) {
            val m = Row("meetings", "m", "work", f = c.getValue("meeting").jsonObject)
            val a = Row("items", "a", "work", f = c.getValue("action").jsonObject)
            assertEquals(c.str("name"), c.str("expected"), draftFor(m = m, a = a))
        }
    }

    @Test fun agenda() {
        for (c in cases("agenda")) {
            val f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as JsonElement }.toMutableMap()
            f.putAll(c.getValue("meeting").jsonObject)
            val points = c.getValue("points").jsonArray.map { it.jsonObject }.map { Row("items", "p", "work", f = mapOf("people" to it.getValue("people"), "title" to it.getValue("title"))) }
            fun list(k: String) = c.getValue(k).jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.str("name"), c.str("markdown"), agendaMarkdown(Row("meetings", "m", "work", f = f), points, list("actions"), list("questions")))
        }
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

    @Test fun parseCapture() {
        for (c in cases("quick-add")) {
            val picked = "pickedAt" in c
            val pickedAt = c.nullable("pickedAt")?.jsonPrimitive?.content?.let { Instant.parse(it).toEpochMilli() }
            val r = parseCapture(c.str("text"), pickedAt, picked, Instant.parse(c.str("now")).toEpochMilli())
            val e = c.getValue("expected").jsonObject
            val actual = listOf(r.title, r.at?.let { Instant.ofEpochMilli(it).toString() }, r.tags, r.repeat)
            val expected = listOf(e.str("title"), e.nullable("at")?.jsonPrimitive?.content, e.getValue("tags").jsonArray.map { it.jsonPrimitive.content }, e.nullable("repeat")?.jsonPrimitive?.content)
            assertEquals(c.str("name"), expected, actual)
        }
    }

    @Test fun goalToLink() {
        for (c in cases("goal-to-link")) {
            val items = c.getValue("items").jsonArray.map { it.jsonObject }.map { o -> item(o.str("id"), o.str("status"), Instant.parse(o.str("at")).toEpochMilli()).copy(deleted = o["deleted"] != null) }
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, goalToLink(items, c.nullable("id")?.jsonPrimitive?.content, Instant.parse(c.str("now")).toEpochMilli())?.id)
        }
    }

    @Test fun reviewQueue() {
        fun strings(c: JsonObject, k: String) = c.getValue(k).jsonArray.map { it.jsonPrimitive.content }
        for (c in cases("review-queue")) assertEquals(c.str("name"), strings(c, "expected"), reviewQueue(strings(c, "order"), strings(c, "skipped"), strings(c, "open").toSet()))
    }

    @Test fun ignoredToday() {
        for (c in cases("ignored-today")) {
            val briefs = c.getValue("briefs").jsonArray.map { it.jsonObject }.map { b ->
                Row("briefs", b.str("id"), b.str("profile"), deleted = b.getValue("deleted").jsonPrimitive.long == 1L, f = mapOf("kind" to b.getValue("kind"), "rows" to b.getValue("rows")))
            }
            val expected = c.getValue("expected").jsonArray.map { it.jsonObject }.map { listOf(it.str("url"), it.str("from"), it.str("gist")) }
            val profile = c.str("profile").takeIf { it != "all" }
            assertEquals(c.str("name"), expected, ignoredToday(briefs, profile, c.getValue("now").jsonPrimitive.long).map { listOf(it.url, it.from, it.gist) })
        }
    }

    @Test fun askRows() {
        for (c in cases("ask-rows")) {
            val r = c.getValue("row").jsonObject
            val row = Row("items", r.str("id"), "work", deleted = r.getValue("deleted").jsonPrimitive.boolean, f = r.filterKeys { it !in setOf("id", "deleted") })
            val name = c.str("name")
            val now = c.getValue("now").jsonPrimitive.long
            assertEquals(name, c.getValue("queued").jsonPrimitive.boolean, queued(row))
            assertEquals(name, c.getValue("inQueue").jsonPrimitive.boolean, replyQueue(listOf(row), null, now).size == 1)
            if (c.containsKey("status")) assertEquals(name, listOf(c.str("status"), c.str("primary"), c.getValue("menu").jsonArray.map { it.jsonPrimitive.content }), listOf(askStatus(row), askPrimary(row), askMenu(row)))
        }
    }

    @Test fun askParts() {
        for (c in cases("ask-parts")) {
            val steps = c.getValue("steps").jsonArray.map { it.jsonObject.let { o -> Check(o.getValue("done").jsonPrimitive.boolean, o.str("label")) } }
            assertEquals(c.str("name"), AskParts(c.str("quote"), steps), askParts(c.str("text")))
        }
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

    @Test fun sinceReadsAges() {
        val now = java.util.Calendar.getInstance().apply { set(java.util.Calendar.HOUR_OF_DAY, 12); set(java.util.Calendar.MINUTE, 0); set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0) }.timeInMillis
        for (c in cases("since")) assertEquals(c.str("name"), c.str("expected"), since(now - c.getValue("agoMs").jsonPrimitive.content.toLong(), now))
    }

    @Test fun moneyByBilling() {
        for (c in cases("money")) assertEquals(c.str("name"), c.str("expected"), money(c.getValue("n").jsonPrimitive.content.toDouble(), c.str("billing")))
    }

    private fun fixture(file: String) = Json.parseToJsonElement(File("../../shared/fixtures/$file.json").readText()).jsonObject

    @Test fun notesTemplates() {
        val fx = fixture("notes-templates")
        for (c in fx.getValue("templates").jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("name"), c.str("text"), notesTemplateText(c.str("key")))
            assertEquals(c.str("name"), c.getValue("caret").jsonPrimitive.int, notesTemplateCaret(c.str("key")))
        }
        for (c in fx.getValue("chips").jsonArray.map { it.jsonObject }) {
            val f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as JsonElement }.toMutableMap()
            f["title"] = c.getValue("title")
            val row = Row("meetings", c.str("id"), c.str("profile"), f = f)
            val picks = c.getValue("picks").jsonObject.mapValues { it.value.jsonPrimitive.content }
            val chips = notesTemplateChips(row, picks).map { it.key to it.selected }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { e -> e.jsonObject.let { it.str("key") to it.getValue("selected").jsonPrimitive.boolean } }, chips)
        }
    }

    @Test fun markSegments() {
        val fx = fixture("mark-segments")
        for (c in fx.getValue("segments").jsonArray.map { it.jsonObject }) {
            val got = markSegments(c.str("text"), c.getValue("words").jsonArray.map { it.jsonPrimitive.content }).map { it.text to it.hit }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { e -> e.jsonArray.let { it[0].jsonPrimitive.content to it[1].jsonPrimitive.boolean } }, got)
        }
        for (c in fx.getValue("labels").jsonArray.map { it.jsonObject }) assertEquals(c.str("expected"), matchLabel(c.getValue("n").jsonPrimitive.int))
        for (c in fx.getValue("steps").jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.int, stepMatch(c.getValue("cur").jsonPrimitive.int, c.getValue("dir").jsonPrimitive.int, c.getValue("count").jsonPrimitive.int))
        }
    }

    @Test fun bottomBar() {
        for (c in cases("bottom-bar")) {
            val events = c.getValue("events").jsonArray.map { e -> BarEvent.valueOf(e.jsonPrimitive.content.replaceFirstChar { it.uppercase() }) }
            val hidden = events.runningFold(BarState(), ::barState).drop(1).map(::barHidden)
            assertEquals(c.str("name"), c.getValue("hidden").jsonArray.map { it.jsonPrimitive.boolean }, hidden)
        }
    }

    @Test fun syncedFieldsMatchHubTables() {
        val tables = Json.parseToJsonElement(File("../../shared/fixtures/tables.json").readText()).jsonObject
        for ((table, fields) in SYNCED_FIELDS) assertEquals(table, tables.getValue(table).jsonArray.map { it.jsonPrimitive.content }, fields)
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

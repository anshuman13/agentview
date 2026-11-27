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
import no.pradhan.agentview.nativeapp.net.loadErrorText
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.long
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.app.chatNotice
import no.pradhan.agentview.nativeapp.app.BarEvent
import no.pradhan.agentview.nativeapp.app.SeenMark
import no.pradhan.agentview.nativeapp.app.mergeSeen
import no.pradhan.agentview.nativeapp.chat.Item
import no.pradhan.agentview.nativeapp.chat.openAtNew
import no.pradhan.agentview.nativeapp.chat.duration
import no.pradhan.agentview.nativeapp.chat.dayDividers
import no.pradhan.agentview.nativeapp.chat.needsEarlier
import no.pradhan.agentview.nativeapp.chat.blockedRule
import no.pradhan.agentview.nativeapp.chat.planFeedback
import no.pradhan.agentview.nativeapp.chat.planParagraphs
import no.pradhan.agentview.nativeapp.chat.newMarker
import no.pradhan.agentview.nativeapp.chat.newReplies
import no.pradhan.agentview.nativeapp.chat.planStep
import no.pradhan.agentview.nativeapp.chat.shipStep
import no.pradhan.agentview.nativeapp.chat.stepLabel
import no.pradhan.agentview.nativeapp.chat.stepTone
import no.pradhan.agentview.nativeapp.chat.attachMark
import no.pradhan.agentview.nativeapp.chat.buildHistory
import no.pradhan.agentview.nativeapp.chat.composerPlaceholder
import no.pradhan.agentview.nativeapp.chat.settingsLabel
import no.pradhan.agentview.nativeapp.chat.ghostFor
import no.pradhan.agentview.nativeapp.chat.findInChat
import no.pradhan.agentview.nativeapp.chat.agentChipCount
import no.pradhan.agentview.nativeapp.chat.findStart
import no.pradhan.agentview.nativeapp.ui.FilePath
import no.pradhan.agentview.nativeapp.ui.filePath
import no.pradhan.agentview.nativeapp.sessions.SavedSession
import no.pradhan.agentview.nativeapp.sessions.chatMatches
import no.pradhan.agentview.nativeapp.sessions.queryWords
import no.pradhan.agentview.nativeapp.sessions.since
import no.pradhan.agentview.nativeapp.sessions.binLeft
import no.pradhan.agentview.nativeapp.sessions.chatBranch
import no.pradhan.agentview.nativeapp.sessions.folderBadge
import no.pradhan.agentview.nativeapp.sessions.FolderBadge
import no.pradhan.agentview.nativeapp.sessions.Glance
import no.pradhan.agentview.nativeapp.chat.failedLine
import no.pradhan.agentview.nativeapp.chat.mergeTail
import no.pradhan.agentview.nativeapp.chat.trimHeld
import no.pradhan.agentview.nativeapp.chat.turnEnd
import no.pradhan.agentview.nativeapp.chat.rememberPrompt
import no.pradhan.agentview.nativeapp.chat.turnAnswers
import no.pradhan.agentview.nativeapp.chat.rewindReplies
import no.pradhan.agentview.nativeapp.chat.rewindTotal
import no.pradhan.agentview.nativeapp.chat.proposalState
import no.pradhan.agentview.nativeapp.chat.usedClaimState
import no.pradhan.agentview.nativeapp.chat.shortModel
import no.pradhan.agentview.nativeapp.chat.startModeFor
import no.pradhan.agentview.nativeapp.chat.checkedModel
import no.pradhan.agentview.nativeapp.chat.modelRow
import no.pradhan.agentview.nativeapp.chat.START_MODES
import no.pradhan.agentview.nativeapp.chat.recentInRepo
import no.pradhan.agentview.nativeapp.chat.startTexts
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
import no.pradhan.agentview.nativeapp.chat.MemoryFile
import no.pradhan.agentview.nativeapp.chat.MemoryMark
import no.pradhan.agentview.nativeapp.chat.memoryMark
import no.pradhan.agentview.nativeapp.chat.leftOutPreferences
import no.pradhan.agentview.nativeapp.chat.ALARM_TOOL
import no.pradhan.agentview.nativeapp.chat.alarmCard
import no.pradhan.agentview.nativeapp.chat.BuildCardOpen
import no.pradhan.agentview.nativeapp.chat.buildCard
import no.pradhan.agentview.nativeapp.chat.buildRows
import no.pradhan.agentview.nativeapp.net.SpawnedBuild
import no.pradhan.agentview.nativeapp.chat.rememberedOf
import no.pradhan.agentview.nativeapp.chat.Proposal
import no.pradhan.agentview.nativeapp.chat.Claim
import no.pradhan.agentview.nativeapp.chat.StatusStep
import no.pradhan.agentview.nativeapp.chat.buildTranscript
import no.pradhan.agentview.nativeapp.chat.foldTurns
import no.pradhan.agentview.nativeapp.chat.WorkTitle
import no.pradhan.agentview.nativeapp.chat.workTitle
import no.pradhan.agentview.nativeapp.chat.draftKey
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
import no.pradhan.agentview.nativeapp.codex.autopilot.TryColumn
import no.pradhan.agentview.nativeapp.codex.autopilot.runLine
import no.pradhan.agentview.nativeapp.codex.autopilot.buildHead
import no.pradhan.agentview.nativeapp.codex.autopilot.stoppedText
import no.pradhan.agentview.nativeapp.sessions.Repo
import no.pradhan.agentview.nativeapp.sessions.Workspace
import no.pradhan.agentview.nativeapp.sessions.Worktree
import no.pradhan.agentview.nativeapp.sessions.chatPlace
import no.pradhan.agentview.nativeapp.sessions.heldOrder
import no.pradhan.agentview.nativeapp.codex.autopilot.LoopNow
import no.pradhan.agentview.nativeapp.codex.autopilot.nowMeta
import no.pradhan.agentview.nativeapp.codex.autopilot.tryColumn
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
import no.pradhan.agentview.nativeapp.workspace.linesQuote
import no.pradhan.agentview.nativeapp.workspace.revertBlock
import no.pradhan.agentview.nativeapp.workspace.splitDiff
import no.pradhan.agentview.nativeapp.codex.wiki.claimActions
import no.pradhan.agentview.nativeapp.codex.wiki.editedClaimText
import no.pradhan.agentview.nativeapp.codex.wiki.givenPreferences
import no.pradhan.agentview.nativeapp.codex.wiki.hasLiveClaims
import no.pradhan.agentview.nativeapp.codex.wiki.isOld
import no.pradhan.agentview.nativeapp.codex.wiki.memoryClaim
import no.pradhan.agentview.nativeapp.codex.wiki.pageClaims
import no.pradhan.agentview.nativeapp.codex.wiki.staleFacts
import no.pradhan.agentview.nativeapp.codex.wiki.wikiAskText
import no.pradhan.agentview.nativeapp.codex.wiki.wikiMarkdown
import kotlinx.serialization.json.buildJsonArray
import no.pradhan.agentview.nativeapp.codex.wiki.ProposalSource
import no.pradhan.agentview.nativeapp.codex.wiki.ReviewFilter
import no.pradhan.agentview.nativeapp.codex.wiki.approveAllChanges
import no.pradhan.agentview.nativeapp.codex.wiki.proposalSource
import no.pradhan.agentview.nativeapp.codex.wiki.rejectChanges
import no.pradhan.agentview.nativeapp.codex.wiki.reviewList
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
import no.pradhan.agentview.nativeapp.codex.jobs.runMeta
import no.pradhan.agentview.nativeapp.codex.jobs.runAsk
import no.pradhan.agentview.nativeapp.codex.jobs.tasksOf
import no.pradhan.agentview.nativeapp.codex.meetings.actionCount
import no.pradhan.agentview.nativeapp.codex.meetings.agendaMarkdown
import no.pradhan.agentview.nativeapp.codex.meetings.draftFor
import no.pradhan.agentview.nativeapp.codex.meetings.linearIssue
import no.pradhan.agentview.nativeapp.codex.jobs.toggleConnector
import no.pradhan.agentview.nativeapp.codex.meetings.displayName
import no.pradhan.agentview.nativeapp.codex.meetings.filterMeetings
import no.pradhan.agentview.nativeapp.codex.meetings.followUpText
import no.pradhan.agentview.nativeapp.codex.meetings.hasContent
import no.pradhan.agentview.nativeapp.codex.meetings.meetingMarkdown
import no.pradhan.agentview.nativeapp.codex.meetings.personMarkdown
import no.pradhan.agentview.nativeapp.codex.meetings.Commitment
import no.pradhan.agentview.nativeapp.codex.meetings.Question
import no.pradhan.agentview.nativeapp.codex.meetings.groupMeetings
import no.pradhan.agentview.nativeapp.codex.meetings.inSeries
import no.pradhan.agentview.nativeapp.codex.meetings.meetingState
import no.pradhan.agentview.nativeapp.codex.meetings.meetingEmpty
import no.pradhan.agentview.nativeapp.codex.meetings.MState
import no.pradhan.agentview.nativeapp.codex.meetings.isLate
import no.pradhan.agentview.nativeapp.codex.meetings.sameName
import no.pradhan.agentview.nativeapp.codex.meetings.seriesTitle
import no.pradhan.agentview.nativeapp.ops.McpServer
import no.pradhan.agentview.nativeapp.ops.McpRow
import no.pradhan.agentview.nativeapp.ops.McpCounts
import no.pradhan.agentview.nativeapp.ops.mcpStatusCounts
import no.pradhan.agentview.nativeapp.ops.mcpMatches
import no.pradhan.agentview.nativeapp.ops.mcpList
import no.pradhan.agentview.nativeapp.ops.mcpFilterCounts
import no.pradhan.agentview.nativeapp.ops.mcpValidFilter
import no.pradhan.agentview.nativeapp.ops.McpFilter
import no.pradhan.agentview.nativeapp.ops.McpMenu
import no.pradhan.agentview.nativeapp.ops.setupPrompt
import no.pradhan.agentview.nativeapp.workspace.Finding
import no.pradhan.agentview.nativeapp.workspace.findingFixPrompt
import no.pradhan.agentview.nativeapp.workspace.findingsFixPrompt
import no.pradhan.agentview.nativeapp.workspace.isSketchPath
import no.pradhan.agentview.nativeapp.workspace.pathCopies
import no.pradhan.agentview.nativeapp.workspace.isSpecPath
import no.pradhan.agentview.nativeapp.workspace.sketchDoc
import no.pradhan.agentview.nativeapp.workspace.sketchMatches
import no.pradhan.agentview.nativeapp.workspace.sketchRename
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

    @Test fun editMarks() {
        for (c in cases("edit-marks")) {
            val n = c.getValue("count").jsonObject
            val want = c.getValue("expected").jsonObject.let { it.str("add") to it.str("del") }
            assertEquals(c.str("name"), want, no.pradhan.agentview.nativeapp.chat.editMarks(n.getValue("add").jsonPrimitive.int, n.getValue("del").jsonPrimitive.int))
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

    @Test fun openAtNew() {
        for (c in cases("open-at-new")) {
            val items = c.getValue("rows").jsonArray.map { it.jsonObject }.map { r ->
                if (r.str("kind") == "assistant") Item.Assistant(r.str("id"), "", r.getValue("streaming").jsonPrimitive.boolean) else Item.System(r.str("id"), "")
            }
            val newId = c.getValue("newId").takeIf { it !is JsonNull }?.jsonPrimitive?.content
            assertEquals(c.str("name"), c["expected"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content, openAtNew(items, newId))
        }
    }

    @Test fun stepLabels() {
        for (c in cases("step-label")) {
            val l = stepLabel(c.str("tool"), c.getValue("input").jsonObject, c.str("cwd"))
            val expected = listOf(c.str("verb"), c.str("object"), c["mono"]?.jsonPrimitive?.boolean == true, c["cmd"]?.jsonPrimitive?.content, c.str("tone"))
            assertEquals(c.str("name"), expected, listOf(l.verb, l.obj, l.mono, l.cmd, stepTone(c.str("tool")).name.lowercase()))
        }
    }

    @Test fun shipStepCases() {
        for (c in cases("ship-step")) {
            val result = c.nullable("result")?.let { ChatEvent(id = "r", kind = "tool_result", text = it.jsonPrimitive.content, isError = c["isError"]?.jsonPrimitive?.boolean == true) }
            val l = shipStep(c.str("command"), result)
            val expected = c.nullable("verb")?.let { listOf(it.jsonPrimitive.content, c.str("object"), c.nullable("url")?.jsonPrimitive?.content) }
            assertEquals(c.str("name"), expected, l?.let { listOf(it.verb, it.obj, it.url) })
        }
    }

    @Test fun planStepCases() {
        for (c in cases("plan-step")) {
            val result = c.nullable("result")?.let { ChatEvent(id = "r", kind = "tool_result", text = it.jsonPrimitive.content, isError = c["isError"]?.jsonPrimitive?.boolean == true) }
            val l = planStep(c.str("plan"), result)
            assertEquals(c.str("name"), listOf(c.str("verb"), c.str("object"), c.nullable("note")?.jsonPrimitive?.content), listOf(l.verb, l.obj, l.note))
        }
    }

    @Test fun dayDividerCases() {
        for (c in cases("day-dividers")) {
            val items = c.getValue("rows").jsonArray.map { it.jsonObject }.map { r ->
                if (r.str("kind") == "user") Item.User(r.str("id"), "", r.getValue("at").jsonPrimitive.long, false, false) else Item.System(r.str("id"), "")
            }
            assertEquals(c.str("name"), c.getValue("expected").jsonObject.mapValues { it.value.jsonPrimitive.content }, dayDividers(items, c.getValue("now").jsonPrimitive.long))
        }
    }

    @Test fun newMarkerCases() {
        val f = Json.parseToJsonElement(File("../../shared/fixtures/new-marker.json").readText()).jsonObject
        val rows = f.getValue("rows").jsonArray.map { it.jsonObject }
        val items = rows.map { r ->
            when (r.str("kind")) {
                "user" -> Item.User(r.str("id"), "", r.getValue("at").jsonPrimitive.long, false, false)
                "assistant" -> Item.Assistant(r.str("id"), "", r["streaming"]?.jsonPrimitive?.boolean == true)
                else -> Item.System(r.str("id"), "")
            }
        }
        val ats = rows.associate { it.str("id") to it.getValue("at").jsonPrimitive.long }
        for (c in f.getValue("marker").jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("name"), c.getValue("expected").takeIf { it !is JsonNull }?.jsonPrimitive?.content, newMarker(items, ats, c.getValue("seen").jsonPrimitive.long, c.getValue("openedAt").jsonPrimitive.long))
        }
        for (c in f.getValue("replies").jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.int, newReplies(items, c.str("lastSeen")))
        }
    }

    @Test fun planComments() {
        val f = Json.parseToJsonElement(File("../../shared/fixtures/plan-comments.json").readText()).jsonObject
        fun strings(e: JsonElement) = e.jsonArray.map { it.jsonPrimitive.content }
        for (c in f.getValue("paragraphs").jsonArray.map { it.jsonObject }) assertEquals(c.str("name"), strings(c.getValue("expected")), planParagraphs(c.str("plan")))
        for (c in f.getValue("feedback").jsonArray.map { it.jsonObject }) {
            val notes = c.getValue("notes").jsonObject.entries.associate { it.key.toInt() to it.value.jsonPrimitive.content }
            assertEquals(c.str("name"), c.str("expected"), planFeedback(strings(c.getValue("paragraphs")), notes))
        }
        for (c in f.getValue("blocked").jsonArray.map { it.jsonObject }) assertEquals(c.str("rule"), c.str("expected"), blockedRule(c.str("rule")))
    }

    @Test fun needsEarlierCases() {
        for (c in cases("needs-earlier")) {
            fun n(k: String) = c.getValue(k).jsonPrimitive.int
            assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.boolean, needsEarlier(n("replies"), n("earlier"), n("autoLoads")))
        }
    }

    @Test fun stepDurations() {
        for (c in cases("step-duration")) assertEquals(c.str("ms"), c.str("expected"), duration(c.getValue("ms").jsonPrimitive.long))
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
            c["claims"]?.let { expected ->
                val want = expected.jsonArray.map { turn -> turn.jsonArray.map { p -> p.jsonObject.let { Claim(it.str("id"), it.str("text"), it.str("where")) } } }
                assertEquals(c.str("name"), want, rows.filterIsInstance<FoldRow.Fold>().map { it.claims })
            }
            c["edits"]?.let { expected -> assertEquals(c.str("name"), expected.jsonArray.map { it.jsonObject.let { e -> e.getValue("add").jsonPrimitive.int to e.getValue("del").jsonPrimitive.int } }, rows.filterIsInstance<FoldRow.Fold>().map { it.work.add to it.work.del }) }
        }
    }

    @Test fun alarmCards() {
        for (c in cases("alarm-card")) {
            val input = kotlinx.serialization.json.buildJsonObject {
                put("time", c.str("time"))
                c.nullable("label")?.let { put("label", it.jsonPrimitive.content) }
            }
            val use = ChatEvent(id = "u", kind = "tool_use", name = ALARM_TOOL, input = input)
            val result = c.nullable("result")?.let { ChatEvent(id = "r", kind = "tool_result", toolUseId = "u", text = it.jsonPrimitive.content) }
            val want = c.getValue("expected").jsonObject
            val got = alarmCard(use, result, c.getValue("running").jsonPrimitive.boolean)
            assertEquals(c.str("name"), listOf(want.str("time"), want.str("label"), want.str("status"), want.str("tone")), listOf(got.time, got.label, got.status, got.tone.name.lowercase()))
        }
    }

    @Test fun buildCards() {
        for (c in cases("build-card")) {
            val input = c.getValue("input").jsonObject
            fun opt(k: String) = (input[k] as? JsonPrimitive)?.contentOrNull ?: ""
            val builds = c.getValue("builds").jsonArray.map { it.decode<SpawnedBuild>() }
            val got = buildCard(opt("spec"), opt("request"), c.nullable("result")?.jsonPrimitive?.content, c.getValue("index").jsonPrimitive.int, builds)
            val want = c.getValue("expected").jsonObject
            val open = (want["open"] as? JsonObject)?.let { o -> o["chat"]?.let { BuildCardOpen.Chat(it.jsonPrimitive.content) } ?: BuildCardOpen.Session(o.str("session")) }
            assertEquals(c.str("name"), listOf(want.str("title"), want.str("status"), want.str("tasks"), want.str("round"), open, want.getValue("found").jsonPrimitive.boolean), listOf(got.title, got.status, got.tasks, got.round, got.open, got.found))
        }
    }

    @Test fun buildRowsCases() {
        for (c in cases("build-rows")) {
            val got = buildRows(c.getValue("builds").jsonArray.map { it.decode<SpawnedBuild>() })
            val want = c.getValue("expected").jsonArray.map { it.jsonObject }.map { w -> listOf(w.str("sessionId"), w.nullable("chatId")?.jsonPrimitive?.content, w.str("title"), w.str("status"), w.getValue("needs").jsonPrimitive.boolean, w.str("meta")) }
            assertEquals(c.str("name"), want, got.map { listOf(it.sessionId, it.chatId, it.title, it.status, it.needs, it.meta) })
        }
    }

    @Test fun remembered() {
        for (c in cases("remembered")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, rememberedOf(buildTranscript(events)))
        }
    }

    @Test fun memoryMarks() {
        for (c in cases("memory-marks")) {
            val facts = c.getValue("facts").jsonArray.map { it.jsonObject }.map { o ->
                val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
                for (k in listOf("text", "state")) o[k]?.let { f[k] = it }
                Row("facts", o.str("id"), o.str("profile"), f = f)
            }
            val want = c.nullable("expected")?.jsonObject?.let { MemoryMark(it.str("mark"), it.str("claim")) }
            assertEquals(c.str("name"), want, memoryMark(c.getValue("file").decode<MemoryFile>(), facts, c.str("profile"), c.getValue("now").jsonPrimitive.long))
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

    @Test fun loadErrors() {
        for (c in cases("load-error")) assertEquals(c.str("name"), c.str("expected"), loadErrorText(c.str("raw")))
    }

    @Test fun syncedAtCases() {
        for (c in cases("synced-at")) assertEquals(c.str("name"), c.str("expected"), syncedAt(c.getValue("last").jsonPrimitive.long, c.getValue("now").jsonPrimitive.long))
    }

    @Test fun syncLines() {
        val now = 1_800_000_000_000L
        for (c in cases("sync-line")) {
            val age = c.nullable("ageMs")?.jsonPrimitive?.long
            val st = CodexState(reconnecting = c.getValue("reconnecting").jsonPrimitive.boolean, error = c.str("error"), pending = c.getValue("pending").jsonPrimitive.int, lastSync = if (age == null) 0 else now - age)
            assertEquals(c.str("name"), c.str("expected"), syncLine(st, now))
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

    @Test fun startMode() {
        for (c in cases("start-mode")) {
            val mode = c.nullable("mode")?.jsonPrimitive?.content
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, startModeFor(mode, c.nullable("provider")?.jsonPrimitive?.content))
        }
    }

    @Test fun startTextsCases() {
        for (c in cases("start-texts")) {
            val m = START_MODES.first { it.label == c.str("start") }
            assertEquals(c.str("name"), c.nullable("mode")?.jsonPrimitive?.content, m.mode)
            val draft = c.nullable("draft")?.jsonPrimitive?.content
            assertEquals(c.str("name"), draft to c.nullable("first")?.jsonPrimitive?.content, startTexts(m, c.nullable("text")?.jsonPrimitive?.content))
        }
    }

    @Test fun recentInRepoCases() {
        for (c in cases("recent-in-repo")) {
            val saved = c.getValue("saved").jsonArray.map { it.jsonObject.let { s -> SavedSession(s.str("sessionId"), cwd = s.str("cwd"), lastModified = s.getValue("lastModified").jsonPrimitive.long) } }
            val open = c.getValue("open").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, recentInRepo(saved, open, c.str("cwd")).map { it.sessionId })
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

    @Test fun runLine() {
        for (c in cases("run-line")) {
            val run = JsonObject(mapOf("id" to toJson("r")) + c.getValue("run").jsonObject).decode<ChatRun>()
            assertEquals(c.str("name"), c.str("expected"), runLine(run))
        }
    }

    @Test fun buildHead() {
        for (c in cases("build-head")) {
            val run = JsonObject(mapOf("id" to toJson("r")) + c.getValue("run").jsonObject).decode<ChatRun>()
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.content, buildHead(run, c.nullable("full")?.jsonPrimitive?.boolean ?: false))
        }
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

    @Test fun stoppedText() {
        for (c in cases("stopped-text")) {
            val run = JsonObject(mapOf("id" to toJson("r")) + c.getValue("run").jsonObject).decode<ChatRun>()
            assertEquals(c.str("name"), c.str("expected"), stoppedText(run))
        }
    }

    @Test fun nowMeta() {
        for (c in cases("now-meta")) {
            val n = c.getValue("now").jsonObject
            val now = LoopNow("", n.nullable("at")?.jsonPrimitive?.long, "status", n.nullable("next")?.jsonPrimitive?.content, n.nullable("stepsLeft")?.jsonPrimitive?.int ?: 0)
            assertEquals(c.str("name"), c.str("expected"), nowMeta(now))
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

    @Test fun ghostFor() {
        for (c in cases("ghost-for")) {
            val events = c.getValue("events").jsonArray.mapIndexed { i, e -> JsonObject(mapOf("id" to toJson("e$i")) + e.jsonObject).decode<ChatEvent>() }
            val saved = c.getValue("saved").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.str("name"), c.str("expected"), ghostFor(c.str("text"), buildHistory(events, saved)))
        }
    }

    @Test fun composerPlaceholder() {
        for (c in cases("composer-placeholder").filter { it.str("device") == "phone" }) {
            assertEquals(c.str("name"), c.str("expected"), composerPlaceholder(c.str("label"), c.str("state"), c["talk"]?.jsonPrimitive?.booleanOrNull ?: true))
        }
    }

    @Test fun turnAnswers() {
        for (c in cases("turn-answers")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }.toSet(), turnAnswers(buildTranscript(events), c["running"]?.jsonPrimitive?.boolean == true))
        }
    }

    @Test fun rewindRepliesCases() {
        for (c in cases("rewind-replies")) {
            val events = c.getValue("events").jsonArray.map { it.decode<ChatEvent>() }
            assertEquals(c.str("name"), c.getValue("expected").jsonObject.mapValues { it.value.jsonPrimitive.content }, rewindReplies(buildTranscript(events)).mapValues { it.value.id })
        }
    }

    @Test fun rewindTotalCases() {
        for (c in cases("rewind-total")) assertEquals(c.str("name"), c.str("expected"), rewindTotal(c.getValue("n").jsonPrimitive.int))
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

    @Test fun filePathCases() {
        for (c in cases("file-path")) {
            val expected = c.getValue("expected").takeIf { it !is JsonNull }?.jsonObject?.let { FilePath(it.str("path"), it["line"]?.jsonPrimitive?.int) }
            assertEquals(c.str("name"), expected, filePath(c.str("text"), c["link"]?.jsonPrimitive?.booleanOrNull == true))
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

    @Test fun agentChipCounts() {
        for (c in cases("agent-count")) assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.int, agentChipCount(c.getValue("all").jsonPrimitive.int, c.getValue("running").jsonPrimitive.int))
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
        }
    }

    @Test fun findingPrompts() {
        for (c in cases("finding-prompts")) {
            val findings = c.getValue("findings").jsonArray.map { protocolJson.decodeFromJsonElement<Finding>(it) }
            c.nullable("one")?.let { assertEquals(c.str("name"), it.jsonPrimitive.content, findingFixPrompt(findings[0])) }
            c.nullable("all")?.let { assertEquals(c.str("name"), it.jsonPrimitive.content, findingsFixPrompt(findings)) }
        }
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
            val o = c.getValue("job").jsonObject
            val job = Row("jobs", "j", o.str("profile"), f = mapOf("account" to (o["account"] ?: JsonNull)))
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

    @Test fun runMetaRule() {
        for (c in cases("run-meta")) assertEquals(c.str("name"), c.str("expected"), runMeta(Row("runs", "r", "work", f = c.getValue("run").jsonObject)))
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

    @Test fun taskMeta() {
        for (c in cases("task-meta")) {
            val row = Row("items", "t", "work", f = listOf("status", "text", "priority", "people").associateWith { c.getValue(it) })
            assertEquals(c.str("name"), TaskMetaParts(c.str("extra"), c.str("preview")), taskMetaParts(row))
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

    @Test fun specSlug() {
        for (c in cases("spec-slug")) assertEquals(c.str("name"), c.str("slug"), specSlug(c.str("path")))
    }

    @Test fun copyPath() {
        for (c in cases("copy-path")) {
            val got = pathCopies(c.str("path"), c.str("cwd"))
            assertEquals(c.str("name"), c.str("absolute"), got.absolute)
            assertEquals(c.str("name"), (c["relative"] as? JsonPrimitive)?.contentOrNull, got.relative)
            assertEquals(c.str("name"), c.str("base"), got.name)
        }
    }

    @Test fun sketchPath() {
        for (c in cases("sketch-path")) assertEquals(c.str("name"), c.getValue("sketch").jsonPrimitive.booleanOrNull, isSketchPath(c.str("path")))
    }

    @Test fun sketchFilter() {
        for (c in cases("sketch-filter")) assertEquals(c.str("name"), c.getValue("shown").jsonArray.map { it.jsonPrimitive.content }, c.getValue("names").jsonArray.map { it.jsonPrimitive.content }.filter { sketchMatches(it, c.str("query")) })
    }

    @Test fun sketchRenameFile() {
        for (c in cases("sketch-rename")) assertEquals(c.str("name"), c.nullable("file")?.jsonPrimitive?.content, sketchRename(c.str("input")))
    }

    @Test fun sketchDoc() {
        for (c in cases("sketch-doc")) assertEquals(c.str("name"), c.str("doc"), sketchDoc(c.str("html"), c.str("theme")))
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

    @Test fun memoryClaim() {
        for (c in cases("memory-claim")) {
            val fact = memoryClaim(c.str("text"), c.str("profile"), c.getValue("now").jsonPrimitive.long)
            val expected = c.nullable("expected")?.jsonObject
            assertEquals(c.str("name"), expected == null, fact == null)
            if (fact == null || expected == null) continue
            for ((k, v) in expected) assertEquals("${c.str("name")}: $k", v.takeIf { it !is JsonNull }?.jsonPrimitive?.content, if (k == "profile") fact.profile else fact.str(k))
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

    @Test fun proposalSource() {
        for (c in cases("proposal-source")) {
            val want = c.nullable("expected")?.jsonObject?.let { ProposalSource(it.str("key"), it.str("label")) }
            assertEquals(c.str("name"), want, proposalSource(c.str("id"), c.nullable("added_by")?.jsonPrimitive?.content))
        }
    }

    @Test fun reviewBatch() {
        fun row(table: String, o: JsonObject, fields: List<String>, defaults: Map<String, Any?>): Row {
            val f = SYNCED_FIELDS.getValue(table).associateWith { JsonNull as JsonElement }.toMutableMap()
            for (k in fields) (o[k] ?: defaults[k]?.let { toJson(it) })?.let { f[k] = it }
            return Row(table, o.str("id"), o["profile"]?.jsonPrimitive?.content ?: "work", deleted = o["deleted"]?.jsonPrimitive?.booleanOrNull == true, f = f)
        }
        fun json(m: Map<String, Any?>) = JsonObject(m.mapValues { toJson(it.value) })
        for (c in cases("review-batch")) {
            val name = c.str("name")
            val pages = c.getValue("pages").jsonArray.map { row("pages", it.jsonObject, listOf("title", "state"), emptyMap()) }
            val facts = c.getValue("facts").jsonArray.map { row("facts", it.jsonObject, listOf("page_id", "replaces", "added_by", "at", "state"), mapOf("state" to "proposed", "at" to 0)) }
            c["expected"]?.jsonObject?.let { want ->
                val v = reviewList(pages, facts, c.str("filter"))
                assertEquals(name, want.getValue("filters").jsonArray.map { it.jsonObject.let { f -> ReviewFilter(f.str("key"), f.str("label"), f.getValue("count").jsonPrimitive.int) } }, v.filters)
                assertEquals(name, want.str("filter"), v.filter)
                assertEquals(name, want.getValue("sections").jsonArray.map { it.jsonObject.str("title") to it.jsonObject.getValue("claims").jsonArray.map { id -> id.jsonPrimitive.content } }, v.sections.map { s -> s.title to s.claims.map { it.id } })
            }
            c["decide"]?.jsonObject?.let { d ->
                val list = d.getValue("ids").jsonArray.map { id -> facts.first { it.id == id.jsonPrimitive.content } }
                val at = d.getValue("now").jsonPrimitive.long
                val changes = if (d.str("action") == "approve") approveAllChanges(list, pages, facts, at) else rejectChanges(list, pages, facts, d.nullable("reason")?.jsonPrimitive?.content, at)
                val want = c.getValue("changes").jsonArray.map { it.jsonObject.let { x -> listOf(x["table"], x["id"], x["patch"], x["undo"]) } }
                assertEquals(name, want, changes.map { listOf(JsonPrimitive(it.row.table), JsonPrimitive(it.row.id), json(it.patch), json(it.undo)) })
            }
        }
    }

    private fun preferenceFacts(c: JsonObject) = c.getValue("facts").jsonArray.map { it.jsonObject }.map { o ->
        val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
        for (k in listOf("text", "page_id", "state", "superseded_by", "contested", "at", "used_at")) o[k]?.let { f[k] = it }
        Row("facts", o.str("id"), o.str("profile"), f = f)
    }

    @Test fun givenPreferences() {
        for (c in cases("preferences")) {
            assertEquals(c.str("name"), c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, givenPreferences(preferenceFacts(c), c.str("profile"), c.getValue("now").jsonPrimitive.long).map { it.id })
        }
    }

    @Test fun leftOutPreferences() {
        for (c in cases("preferences-left")) {
            assertEquals(c.str("name"), c.getValue("expected").jsonPrimitive.int, leftOutPreferences(preferenceFacts(c), c.str("profile"), c.getValue("now").jsonPrimitive.long))
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

    @Test fun wikiAskText() {
        val c = Json.parseToJsonElement(File("../../shared/fixtures/wiki-ask.json").readText()).jsonObject
        val pages = c.getValue("pages").jsonArray.map { it.jsonObject }.map { Row("pages", it.str("id"), "work", f = mapOf("title" to it.getValue("title"))) }
        val facts = c.getValue("facts").jsonArray.map { it.jsonObject }.map { o ->
            val sources = buildJsonArray { o.getValue("sources").jsonArray.forEach { s -> add(buildJsonObject { put("kind", "doc"); put("label", s.jsonPrimitive.content) }) } }.toString()
            val f = SYNCED_FIELDS.getValue("facts").associateWith { JsonNull as JsonElement }.toMutableMap()
            listOf("text", "page_id", "at", "state", "contested").forEach { f[it] = o.getValue(it) }
            f["sources"] = toJson(sources)
            Row("facts", o.str("id"), "work", updatedAt = o.getValue("updated_at").jsonPrimitive.long, f = f)
        }
        val now = c.getValue("now").jsonPrimitive.long
        for (x in c.getValue("cases").jsonArray.map { it.jsonObject }) {
            assertEquals(x.str("name"), x.str("expected"), wikiAskText(x.str("question"), pages, facts, x.nullable("pageId")?.jsonPrimitive?.content, now))
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
        for (m in c.getValue("moves").jsonArray.map { it.jsonObject }) assertEquals(m.str("name"), m.nullable("expected")?.jsonPrimitive?.content, moveRule(m.str("text"), time(m, "from"), time(m, "to"), 0L))
    }

    @Test fun dateSheet() {
        val c = Json.parseToJsonElement(File("../../shared/fixtures/date-sheet.json").readText()).jsonObject
        fun local(s: String) = java.time.LocalDateTime.parse(s).atZone(codexZone).toInstant().toEpochMilli()
        fun text(e: JsonElement) = (e as? JsonPrimitive)?.contentOrNull
        for (k in c.getValue("compose").jsonArray.map { it.jsonObject }) assertEquals(k.str("name"), k.nullable("expected")?.jsonPrimitive?.content?.let(::local), composeDue(java.time.LocalDate.parse(k.str("day")), k.nullable("time")?.jsonPrimitive?.content, local(k.str("now"))))
        for (k in c.getValue("quick").jsonArray.map { it.jsonObject }) assertEquals(k.str("name"), k.getValue("expected").jsonArray.map { e -> e.jsonArray.map(::text) }, quickDays(local(k.str("now"))).map { listOf(it.label, it.day.toString(), it.time) })
        for (k in c.getValue("month").jsonArray.map { it.jsonObject }) {
            val cells = monthCells(java.time.YearMonth.parse(k.str("month")))
            val lead = k.getValue("lead").jsonPrimitive.int
            assertEquals(k.str("month"), listOf(lead, k.getValue("count").jsonPrimitive.int, 1), listOf(cells.count { it == null }, cells.size - lead, cells[lead]!!.dayOfMonth))
        }
        for (r in c.getValue("remind").jsonArray) assertEquals(text(r.jsonArray[1]), remindLabel(text(r.jsonArray[0])?.toInt()))
        for (r in c.getValue("repeat").jsonArray) assertEquals(text(r.jsonArray[1]), repeatLabel(text(r.jsonArray[0])!!))
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

    @Test fun suggestedEstimate() {
        for (c in cases("suggest-estimate")) {
            val rows = c.getValue("tasks").jsonArray.mapIndexed { i, t -> Row("items", "t$i", "work", f = listOf("title", "status", "spent").associateWith { t.jsonObject.getValue(it) }) }
            assertEquals(c.str("name"), c.nullable("expected")?.jsonPrimitive?.long, suggestEstimate(c.str("title"), rows))
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

    private fun copyMeeting(c: JsonObject): Row {
        val f = SYNCED_FIELDS.getValue("meetings").associateWith { JsonNull as JsonElement }.toMutableMap()
        f.putAll(c.getValue("meeting").jsonObject)
        return Row("meetings", "m", "work", f = f)
    }

    private fun copyActions(c: JsonObject) =
        c.getValue("actions").jsonArray.map { it.jsonObject }.map { Row("items", it.str("title"), "work", f = mapOf("title" to it.getValue("title"), "status" to it.getValue("status"))) }

    @Test fun meetingCopy() {
        for (c in cases("meeting-copy")) {
            val m = copyMeeting(c)
            val actions = copyActions(c)
            val name = c.str("name")
            assertEquals(name, c.getValue("hasContent").jsonPrimitive.boolean, hasContent(m, actions))
            assertEquals(name, c.str("followUp"), followUpText(m, actions))
            assertEquals(name, c.str("markdown"), meetingMarkdown(m, actions))
        }
    }

    @Test fun meetingAskText() {
        for (c in cases("meeting-ask")) assertEquals(c.str("name"), c.str("expected"), meetingAsk(copyMeeting(c), copyActions(c), c.getValue("now").jsonPrimitive.long))
    }

    @Test fun prepText() {
        for (c in cases("prep-text")) assertEquals(c.str("name"), c.str("expected"), prepText(copyMeeting(c)))
    }

    @Test fun runAskText() {
        fun xs(s: String) = Regex("\\{x(\\d+)\\}").replace(s) { "x".repeat(it.groupValues[1].toInt()) }
        for (c in cases("run-ask")) assertEquals(c.str("name"), xs(c.str("expected")), runAsk(c.str("job"), c.getValue("started_at").jsonPrimitive.long, xs(c.str("output"))))
    }

    @Test fun linksInNotes() {
        for (c in cases("links-in")) {
            val expected = c.getValue("expected").jsonArray.map { it.jsonObject.let { o -> listOf(o.str("url"), o.str("domain"), o.str("path")) } }
            assertEquals(c.str("name"), expected, linksIn(c.str("notes")).map { listOf(it, linkDomain(it), linkPath(it)) })
        }
    }

    @Test fun personCopy() {
        for (c in cases("person-copy")) {
            fun meeting(o: JsonElement) = Row("meetings", "m", "work", f = o.jsonObject)
            fun rows(k: String) = c.getValue(k).jsonArray.map { Row("items", "i", "work", f = it.jsonObject) }
            val commitments = c.getValue("commitments").jsonArray.map { Commitment(meeting(it.jsonObject.getValue("meeting")), it.jsonObject.str("what")) }
            val questions = c.getValue("questions").jsonArray.map { Question(it.jsonPrimitive.content, meeting(JsonObject(emptyMap())), 0, "work") }
            val md = personMarkdown(c.str("person"), commitments, questions, rows("tasks"), rows("points"), rows("pins"), c.getValue("meetings").jsonArray.map(::meeting), rows("claims"))
            assertEquals(c.str("name"), c.str("expected"), md)
        }
    }

    @Test fun actionDraft() {
        for (c in cases("action-draft")) {
            val m = Row("meetings", "m", "work", f = c.getValue("meeting").jsonObject)
            val a = Row("items", "a", "work", f = c.getValue("action").jsonObject)
            assertEquals(c.str("name"), c.str("expected"), draftFor(m = m, a = a))
        }
    }

    @Test fun linearIssueUrl() {
        for (c in cases("linear-issue")) {
            val m = Row("meetings", "m", "work", f = c.getValue("meeting").jsonObject)
            val a = Row("items", "a", "work", f = c.getValue("action").jsonObject)
            assertEquals(c.str("name"), c.str("expected"), linearIssue(a, m))
        }
    }

    @Test fun linesQuoteCases() {
        for (c in cases("lines-quote")) assertEquals(c.str("name"), c.str("expected"), linesQuote(c.str("path"), c.getValue("start").jsonPrimitive.int, c.getValue("end").jsonPrimitive.int, c.str("text")))
    }

    @Test fun chatBranchCases() {
        for (c in cases("chat-branch")) assertEquals(c.str("name"), c.prim("expected")?.contentOrNull, chatBranch(c.prim("saved")?.contentOrNull, c.prim("repo")?.contentOrNull))
    }

    @Test fun folderBadgeCases() {
        for (c in cases("folder-badge")) {
            val e = c["expected"]?.takeIf { it !is JsonNull }?.jsonObject
            val got = folderBadge(Glance(c.getValue("running").jsonPrimitive.int, c.getValue("needs").jsonPrimitive.int, c.getValue("unread").jsonPrimitive.int))
            assertEquals(c.str("name"), e?.let { FolderBadge(it.getValue("count").jsonPrimitive.int, it.str("label")) }, got)
        }
    }

    @Test fun toggleConnectorCases() {
        for (c in cases("toggle-connector")) assertEquals(c.str("name"), c.str("expected"), toggleConnector(c.str("tools"), c.str("id")))
    }

    @Test fun mcpGroups() {
        for (c in cases("mcp-groups")) {
            val rows = c.getValue("rows").jsonArray.map { it.jsonObject }.map { r ->
                McpRow(McpServer(r.str("name"), r.str("status"), scope = r.prim("scope")?.contentOrNull, type = r.prim("type")?.contentOrNull, error = r.prim("error")?.contentOrNull), live = r["live"]?.jsonPrimitive?.boolean == true, account = r.prim("account")?.contentOrNull)
            }.filter { mcpMatches(it, c.prim("query")?.contentOrNull ?: "") }
            val hidden = c["hidden"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
            val isHidden = { r: McpRow -> r.name in hidden }
            val f = c["filter"]?.jsonObject?.let { McpFilter(it.str("show"), it.str("where")) } ?: McpFilter()
            val menu = mcpFilterCounts(rows, f, isHidden)
            val expected = c.getValue("expected").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(c.str("name"), expected, mcpList(rows, mcpValidFilter(f, menu), isHidden).map { it.name })
            c["counts"]?.jsonObject?.let { n ->
                fun i(k: String) = n.getValue(k).jsonPrimitive.content.toInt()
                assertEquals(c.str("name"), McpCounts(i("connected"), i("total"), i("needsYou")), mcpStatusCounts(rows))
            }
            c["menu"]?.jsonObject?.let { n ->
                fun pairs(k: String) = n.getValue(k).jsonArray.map { it.jsonArray[0].jsonPrimitive.content to it.jsonArray[1].jsonPrimitive.content.toInt() }
                assertEquals(c.str("name"), McpMenu(pairs("show"), pairs("where")), menu)
            }
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

    @Test fun meetingEmptyStates() {
        for (c in cases("meeting-empty")) {
            val state = MState.valueOf(c.str("state").replaceFirstChar { it.uppercase() })
            assertEquals(c.str("name"), c.str("title") to c.str("hint"), meetingEmpty(state, c.str("part")))
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

    @Test fun splitDiff() {
        for (c in cases("split-diff")) assertEquals(c.str("name"), c.getValue("expected").jsonObject.entries.map { it.key to it.value.jsonPrimitive.content }, splitDiff(c.str("diff")).toList())
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

    @Test fun taskChecklist() {
        for (c in cases("task-checklist")) {
            val n = c["toggle"]?.jsonPrimitive?.int
            assertEquals(c.str("name"), c.str("expected"), if (n == null) addCheck(c.str("text"), c.str("add")) else toggleCheck(c.str("text"), n))
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

    @Test fun modelRowCases() {
        for (c in cases("model-row")) {
            val shown = c.getValue("shown").jsonArray.map { val p = it.jsonArray; ModelInfo(p[0].jsonPrimitive.content, p[1].jsonPrimitive.content) }
            assertEquals(c.str("name"), c.nullable("row")?.jsonPrimitive?.content, modelRow(shown, c.nullable("model")?.jsonPrimitive?.content))
        }
    }

    @Test fun settingsLabelCases() {
        for (c in cases("settings-label")) {
            assertEquals(c.str("name"), c.str("label"), settingsLabel(c.str("model"), c.nullable("effort")?.jsonPrimitive?.content, c.getValue("canEffort").jsonPrimitive.boolean, c.str("provider"), c.str("mode"), c.getValue("review").jsonPrimitive.boolean))
        }
    }

    @Test fun checkedModelCases() {
        for (c in cases("checked-model")) {
            val shown = c.getValue("shown").jsonArray.map { ModelInfo(it.jsonPrimitive.content, it.jsonPrimitive.content) }
            assertEquals(c.str("name"), c.nullable("checked")?.jsonPrimitive?.content, checkedModel(shown, c.nullable("model")?.jsonPrimitive?.content))
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

    @Test fun binLeftCases() {
        val now = 1_000_000_000_000L
        for (c in cases("bin-left")) assertEquals(c.str("name"), c.str("expected"), binLeft(now - c.getValue("agoMs").jsonPrimitive.long, now))
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

package no.pradhan.agentview.nativeapp.sessions

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import no.pradhan.agentview.nativeapp.codex.autopilot.everyText
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.DotState

// shared/builds.ts as the server's /api/builds and /api/builds/one return it; the summaries are finished, so nothing is derived here.
@Serializable
data class BuildRow(val slug: String, val title: String = "", val stage: String = "", val state: String = "", val conclusion: String = "", val updatedAt: Long = 0, val pipeline: String = "written", val draft: Boolean = false)

@Serializable
data class BuildFile(val path: String, val additions: Int = 0, val deletions: Int = 0)

@Serializable
data class BuildCommit(val sha: String = "", val subject: String = "", val branch: String? = null, val files: List<BuildFile> = emptyList())

@Serializable
data class Criterion(val n: Int = 0, val result: String = "", val evidence: String = "")

@Serializable
data class BuildEntry(
    val id: String,
    val stage: String = "",
    val round: Int = 1,
    val status: String = "",
    val startedAt: Long = 0,
    val endedAt: Long? = null,
    val report: String = "",
    val chat: String = "",
    val session: String? = null,
    val commit: BuildCommit? = null,
    val verdict: String? = null,
    val criteria: List<Criterion> = emptyList(),
    val findings: List<String> = emptyList(),
)

@Serializable
data class BuildSummary(val stage: String = "", val state: String = "", val conclusion: String = "")

@Serializable
data class CommitFile(val path: String, val add: Int = 0, val del: Int = 0)

@Serializable
data class CommitDiff(val files: List<CommitFile> = emptyList(), val diff: String = "")

@Serializable
data class BuildPhase(val key: String, val markdown: String = "")

@Serializable
data class BuildReview(val phase: String = "", val decision: String = "", val note: String = "", val at: Long = 0)

@Serializable
data class BuildDetail(
    val slug: String,
    val title: String = "",
    val summary: BuildSummary = BuildSummary(),
    val specFile: String? = null,
    val phases: List<BuildPhase> = emptyList(),
    val reviews: List<BuildReview> = emptyList(),
    val entries: List<BuildEntry> = emptyList(),
    val commit: CommitDiff? = null,
)

fun parseBuilds(body: String): List<BuildRow> = protocolJson.decodeFromString(ListSerializer(BuildRow.serializer()), body)

fun parseBuild(body: String): BuildDetail = protocolJson.decodeFromString(BuildDetail.serializer(), body)

private val STAGE_NAME = mapOf("pm" to "Spec", "review" to "Spec review", "implement" to "Implement", "test" to "Test", "code-review" to "Code review")

fun stageName(stage: String) = STAGE_NAME[stage] ?: stage

private val PIPELINE_LABEL = mapOf("written" to "Spec written", "reviewed" to "Spec reviewed", "implemented" to "Implemented", "tested" to "Tested", "code-reviewed" to "Code reviewed", "merged" to "Merged")

fun pipelineLabel(pipeline: String) = PIPELINE_LABEL[pipeline] ?: pipeline

fun stateDot(state: String) = when (state) { "done" -> DotState.Ok; "failed" -> DotState.Bad; "waiting" -> DotState.Warn; else -> DotState.Faint }

fun stateBadge(state: String): Pair<String, BadgeTone> = when (state) {
    "done" -> "Done" to BadgeTone.Done
    "failed" -> "Failed" to BadgeTone.Failed
    "waiting" -> "Waiting" to BadgeTone.Waiting
    else -> "Running" to BadgeTone.Running
}

fun stageBadge(e: BuildEntry): Pair<String, BadgeTone> = if (e.status == "stopped") "Skipped" to BadgeTone.Quiet else stateBadge(e.status)

fun criterionBadge(c: Criterion): Pair<String, BadgeTone> = when (c.result) {
    "pass" -> "Done" to BadgeTone.Done
    "fail" -> "Failed" to BadgeTone.Failed
    else -> "Skipped" to BadgeTone.Quiet
}

fun stageTitle(e: BuildEntry) = stageName(e.stage) + if (e.round > 1) " · round ${e.round}" else ""

fun byStart(entries: List<BuildEntry>) = entries.sortedBy { it.startedAt }

fun updatedAt(entries: List<BuildEntry>) = entries.maxOfOrNull { it.endedAt ?: it.startedAt } ?: 0

fun stageMeta(e: BuildEntry): String {
    val ms = e.endedAt?.let { it - e.startedAt }
    val took = ms?.let { if (it < 60_000) "${Math.round(it / 1000.0)}s" else everyText(it) }
    return listOfNotNull(e.verdict?.replaceFirstChar(Char::uppercase), took).joinToString(" · ")
}

const val BUILD_FOLD = 3

class BuildGroup(val key: String, val label: String, val rows: List<BuildRow>)

// Active builds stay open; drafts and merged ones fold to BUILD_FOLD rows. An empty group is left out.
fun buildGroups(builds: List<BuildRow>) = listOf(
    BuildGroup("active", "Active", builds.filter { !it.draft && it.pipeline != "merged" }),
    BuildGroup("drafts", "Drafts", builds.filter { it.draft }),
    BuildGroup("merged", "Merged", builds.filter { it.pipeline == "merged" }),
).filter { it.rows.isNotEmpty() }

fun phaseLabel(key: String) = key.replaceFirstChar(Char::uppercase)

fun decisionTitle(r: BuildReview?) = when (r?.decision) { null -> "Not reviewed"; "approve" -> "Approved"; else -> "Changes requested" }

fun reviewDecision(reviews: List<BuildReview>, phase: String) = reviews.lastOrNull { it.phase == phase }

fun phaseApproved(reviews: List<BuildReview>, phase: String) = reviewDecision(reviews, phase)?.decision == "approve"

fun startPhase(phases: List<BuildPhase>, reviews: List<BuildReview>) = (phases.firstOrNull { !phaseApproved(reviews, it.key) } ?: phases.first()).key

fun nextPhase(phases: List<BuildPhase>, key: String) = phases.getOrNull(phases.indexOfFirst { it.key == key } + 1)?.key ?: key

class StageRow(val at: Long, val entry: BuildEntry? = null, val review: BuildReview? = null)

// The agent stages and the user's decisions in time order.
fun stageRows(entries: List<BuildEntry>, reviews: List<BuildReview>) =
    (byStart(entries).map { StageRow(it.startedAt, entry = it) } + reviews.map { StageRow(it.at, review = it) }).sortedBy { it.at }

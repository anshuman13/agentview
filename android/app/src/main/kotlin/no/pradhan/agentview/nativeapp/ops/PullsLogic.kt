package no.pradhan.agentview.nativeapp.ops

import no.pradhan.agentview.nativeapp.workspace.PrFile
import no.pradhan.agentview.nativeapp.ui.DiffLine
import no.pradhan.agentview.nativeapp.ui.lineDiff
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.sessions.metaLine
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.Status

@Serializable data class PrAutoMerge(val note: String = "", val error: String = "")

// shared/protocol.ts PullRequest and PullRequestDetail, read by web/src/ops/GitHub.tsx.
@Serializable
data class PullRequest(
    val number: Int,
    val title: String = "",
    val author: String = "",
    val branch: String = "",
    val draft: Boolean = false,
    val review: String = "",
    val checks: String = "none",
    val updatedAt: String = "",
    val url: String = "",
    val sha: String = "",
    val additions: Int = 0,
    val deletions: Int = 0,
    val mine: Boolean = false,
    val reviewRequested: Boolean = false,
    val autoMerge: PrAutoMerge? = null,
)

// Armed and not stopped by a failed merge.
val PullRequest.autoMergeOn get() = autoMerge != null && autoMerge.error.isEmpty()

fun PrAutoMerge.autoMergeMeta() = if (error.isNotEmpty()) "Merge failed · $error" else note

@Serializable data class PrCheck(val name: String, val state: String = "none", val url: String = "")
@Serializable data class PrReview(val author: String, val state: String = "", val body: String = "", val at: String = "")
@Serializable data class PrCommit(val oid: String, val message: String = "", val author: String = "")

@Serializable
data class PullRequestDetail(
    val body: String = "",
    val checks: List<PrCheck> = emptyList(),
    val reviews: List<PrReview> = emptyList(),
    val files: List<PrFile> = emptyList(),
    val commits: List<PrCommit> = emptyList(),
    val diff: String = "",
)

fun parsePulls(body: String): List<PullRequest> = protocolJson.decodeFromString(ListSerializer(PullRequest.serializer()), body)
fun parsePullDetail(body: String): PullRequestDetail = protocolJson.decodeFromString(PullRequestDetail.serializer(), body)

data class PrGroup(val title: String, val prs: List<PullRequest>)

fun prGroups(prs: List<PullRequest>) = listOf(
    PrGroup("Waiting for my review", prs.filter { it.reviewRequested }),
    PrGroup("My pull requests", prs.filter { it.mine }),
    PrGroup("All open", prs),
)

// web/src/ops/pulls.tsx REVIEW: the label and tone of a review state; unknown states show nothing.
fun reviewLabel(state: String): Pair<String, Status>? = when (state) {
    "APPROVED" -> "Approved" to Status.Ok
    "CHANGES_REQUESTED" -> "Changes requested" to Status.Warn
    "REVIEW_REQUIRED" -> "Review required" to Status.Warn
    "COMMENTED" -> "Commented" to Status.Neutral
    "DISMISSED" -> "Dismissed" to Status.Neutral
    "PENDING" -> "Pending" to Status.Warn
    else -> null
}

fun checkDot(state: String) = when (state) {
    "success" -> DotState.Ok
    "failure" -> DotState.Bad
    "pending" -> DotState.Busy
    else -> DotState.Faint
}

data class GhProblem(val title: String, val text: String, val cmd: String?)

fun ghProblem(error: String): GhProblem? = when {
    Regex("not installed", RegexOption.IGNORE_CASE).containsMatchIn(error) -> GhProblem("GitHub CLI not installed", "Install it, then refresh.", "brew install gh")
    Regex("not logged in", RegexOption.IGNORE_CASE).containsMatchIn(error) -> GhProblem("Not signed in to GitHub", "Sign in with the GitHub CLI, then refresh.", "gh auth login")
    Regex("no GitHub remote", RegexOption.IGNORE_CASE).containsMatchIn(error) -> GhProblem("No GitHub remote", "Open a chat in a folder whose repository lives on GitHub.", null)
    else -> null
}

fun reviewBody(event: String, text: String) = buildJsonObject { put("event", event); put("body", text) }.toString()
fun mergeBody(method: String) = buildJsonObject { put("method", method) }.toString()
fun autoMergeBody(on: Boolean, method: String) = buildJsonObject { put("on", on); put("method", method) }.toString()

val MERGE_METHODS = listOf("squash" to "Squash", "merge" to "Merge commit", "rebase" to "Rebase")

// The open PR of the chat's branch, and its merge readiness for the strip under the chat header.
fun branchPr(prs: List<PullRequest>, branch: String) = prs.firstOrNull { branch.isNotEmpty() && it.branch == branch }

fun checksLabel(state: String) = when (state) {
    "success" -> "Checks passed"
    "failure" -> "Checks failed"
    "pending" -> "Checks running"
    else -> null
}

// The PR part of a chat row: "#123" with the review state, and a check dot only when the PR and its checks are known.
data class PrChip(val text: String, val dot: DotState?, val url: String)

// checks is the server's LiveChat.prChecks, used when the repo's PR list is not loaded.
fun prChip(number: Int, pr: PullRequest?, checks: String? = null): PrChip {
    val state = pr?.let { if (it.draft) "Draft" else reviewLabel(it.review)?.first }
    val dot = (pr?.checks ?: checks)?.takeIf { it != "none" }?.let { checkDot(it) }
    return PrChip(metaLine("#$number", state), dot, pr?.url.orEmpty())
}

fun prStripMeta(pr: PullRequest) = listOfNotNull("#${pr.number}", "Draft".takeIf { pr.draft }, checksLabel(pr.checks), reviewLabel(pr.review)?.first).joinToString(" · ")

// A draft asking the chat to fix its PR's failing checks and requested changes; null when nothing needs fixing.
fun fixPrPrompt(number: Int, d: PullRequestDetail): String? {
    val failed = d.checks.filter { it.state == "failure" }.map { it.name }.distinct()
    val asked = d.reviews.filter { it.state == "CHANGES_REQUESTED" }.map { it.author }.distinct()
    if (failed.isEmpty() && asked.isEmpty()) return null
    val parts = listOfNotNull(
        failed.takeIf { it.isNotEmpty() }?.let { "the failing checks (${it.joinToString(", ")})" },
        asked.takeIf { it.isNotEmpty() }?.let { "the changes ${it.joinToString(", ")} requested" },
    )
    return "PR #$number: fix ${parts.joinToString(" and ")}. Read the logs and review comments with gh, push the fix, and tell me what changed."
}

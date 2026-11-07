package no.pradhan.agentview.nativeapp

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// shared/protocol.ts GitStatus, read by web/src/workspace/Changes.tsx.
@Serializable
data class GitFile(val path: String, val status: String = "M", val staged: Boolean = false)

@Serializable
data class GitStatus(val branch: String = "", val ahead: Int = 0, val behind: Int = 0, val files: List<GitFile> = emptyList())

fun parseGitStatus(body: String): GitStatus = protocolJson.decodeFromString(GitStatus.serializer(), body)

fun letterOf(f: GitFile) = if (f.status == "?") "U" else f.status

val GIT_STATUS = mapOf("M" to "Modified", "A" to "Added", "D" to "Deleted", "R" to "Renamed", "U" to "Untracked")

fun pathsBody(files: List<GitFile>) = buildJsonObject { put("paths", JsonArray(files.map { JsonPrimitive(it.path) })) }.toString()
fun commitBody(message: String) = buildJsonObject { put("message", message) }.toString()

fun discardTitle(files: List<GitFile>) = if (files.size == 1) "Discard changes in ${files[0].path}?" else "Discard changes in ${files.size} files?"
fun discardDetail(files: List<GitFile>) = if (files.any { it.status == "?" }) "Untracked files are deleted, other files go back to their last staged or committed version. This cannot be undone."
else "The files go back to their last staged or committed version. This cannot be undone."

// The diff of a file against HEAD: the common head and tail are kept as is, only the middle is compared line by line.
fun fileDiff(original: String, content: String): List<DiffLine> {
    val a = original.split('\n')
    val b = content.split('\n')
    var head = 0
    while (head < a.size && head < b.size && a[head] == b[head]) head++
    var tail = 0
    while (tail < a.size - head && tail < b.size - head && a[a.size - 1 - tail] == b[b.size - 1 - tail]) tail++
    val mid = lineDiff(a.subList(head, a.size - tail).joinToString("\n"), b.subList(head, b.size - tail).joinToString("\n"))
        .let { if (head < a.size - tail || head < b.size - tail) it else emptyList() }
    return a.subList(0, head).map { DiffLine(' ', it) } + mid + a.subList(a.size - tail, a.size).map { DiffLine(' ', it) }
}

// Unchanged runs longer than twice the context fold to one '@' line saying how many lines it hides.
fun changesOnly(lines: List<DiffLine>, context: Int = 3): List<DiffLine> {
    val near = BooleanArray(lines.size)
    lines.forEachIndexed { i, l -> if (l.mark != ' ') for (k in maxOf(0, i - context)..minOf(lines.size - 1, i + context)) near[k] = true }
    val out = mutableListOf<DiffLine>()
    var hidden = 0
    lines.forEachIndexed { i, l ->
        if (near[i]) {
            if (hidden > 0) out += DiffLine('@', "$hidden unchanged lines")
            hidden = 0
            out += l
        } else hidden++
    }
    if (hidden > 0) out += DiffLine('@', "$hidden unchanged lines")
    return out
}

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
)

@Serializable data class PrCheck(val name: String, val state: String = "none", val url: String = "")
@Serializable data class PrReview(val author: String, val state: String = "", val body: String = "", val at: String = "")
@Serializable data class PrFile(val path: String, val additions: Int = 0, val deletions: Int = 0)
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

data class PrGroup(val title: String, val empty: String, val prs: List<PullRequest>)

fun prGroups(prs: List<PullRequest>) = listOf(
    PrGroup("Waiting for my review", "No pull requests waiting for you", prs.filter { it.reviewRequested }),
    PrGroup("My pull requests", "No pull requests of yours", prs.filter { it.mine }),
    PrGroup("All open", "No open pull requests", prs),
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

// The file diffs of a PR's unified diff, by path, each starting at its first hunk.
fun splitDiff(diff: String): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    val head = Regex("^diff --git a/.* b/(.*)$", RegexOption.MULTILINE)
    for (part in diff.split(Regex("(?m)^(?=diff --git )"))) {
        val m = head.find(part) ?: continue
        val at = part.indexOf("\n@@")
        out[m.groupValues[1]] = if (at >= 0) part.substring(at + 1) else ""
    }
    return out
}

fun diffMark(line: String) = when {
    line.startsWith("@@") -> '@'
    line.startsWith("+") -> '+'
    line.startsWith("-") -> '-'
    else -> ' '
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

val MERGE_METHODS = listOf("squash" to "Squash", "merge" to "Merge commit", "rebase" to "Rebase")

fun isoMillis(iso: String): Long = runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)

// web/src/ui/util.tsx ago: "now", "5m", "3h", "2d", "1w".
fun agoShort(t: Long, now: Long, suffix: String = ""): String {
    if (t <= 0) return ""
    val m = maxOf(0L, (now - t) / 60_000)
    if (m < 1) return "now"
    val text = when {
        m < 60 -> "${m}m"
        m < 1440 -> "${Math.round(m / 60.0)}h"
        m < 10080 -> "${Math.round(m / 1440.0)}d"
        else -> "${Math.round(m / 10080.0)}w"
    }
    return text + suffix
}

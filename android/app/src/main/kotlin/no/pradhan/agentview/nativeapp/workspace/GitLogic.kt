package no.pradhan.agentview.nativeapp.workspace

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

// shared/protocol.ts GitStatus, read by web/src/workspace/Changes.tsx.
@Serializable
data class GitFile(val path: String, val status: String = "M", val staged: Boolean = false)

@Serializable
data class GitStatus(val branch: String = "", val ahead: Int = 0, val behind: Int = 0, val files: List<GitFile> = emptyList())

fun parseGitStatus(body: String): GitStatus = protocolJson.decodeFromString(GitStatus.serializer(), body)

fun letterOf(f: GitFile) = if (f.status == "?") "U" else f.status

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

fun PrAutoMerge.line() = if (error.isNotEmpty()) "Merge failed · $error" else note

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

// A unified patch as diff lines: the mark from the first column, hunk headers kept whole.
fun patchLines(patch: String): List<DiffLine> = patch.trimEnd('\n').split('\n').map { l ->
    val mark = diffMark(l)
    DiffLine(mark, if (mark == '@' || l.isEmpty()) l else l.substring(1))
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
fun autoMergeBody(on: Boolean, method: String) = buildJsonObject { put("on", on); put("method", method) }.toString()

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

// A diff line with its line number: in the new file for kept and added lines, in the old file for removed ones, 0 for a fold.
data class DiffRow(val line: DiffLine, val no: Int)

fun diffRows(lines: List<DiffLine>, onlyChanges: Boolean, context: Int = 3): List<DiffRow> {
    var old = 0
    var new = 0
    val numbered = lines.map { l ->
        DiffRow(l, when (l.mark) { '-' -> ++old; '+' -> ++new; else -> { old++; ++new } })
    }
    if (!onlyChanges) return numbered
    val folded = changesOnly(lines, context)
    var i = 0
    return folded.map { f -> if (f.mark == '@') DiffRow(f, 0) else { while (numbered[i].line !== f) i++; numbered[i++] } }
}

// A file against HEAD as a diff; a file with no committed version is all additions.
fun fileDiffLines(original: String, content: String): List<DiffLine> =
    if (original.isEmpty()) content.removeSuffix("\n").split('\n').filter { content.isNotEmpty() }.map { DiffLine('+', it) } else fileDiff(original, content)

fun diffCounts(lines: List<DiffLine>) = lines.count { it.mark == '+' } to lines.count { it.mark == '-' }

// Change blocks are the runs of - and + lines between unchanged ones, numbered from 0; -1 for an unchanged line.
fun blockOf(lines: List<DiffLine>, line: DiffLine): Int {
    var block = -1
    var inBlock = false
    for (l in lines) {
        if (l.mark == ' ') inBlock = false else if (!inBlock) { block++; inBlock = true }
        if (l === line) return if (l.mark == ' ') -1 else block
    }
    return -1
}

// The file text with one change block put back to its committed lines, like Zed's reject on one hunk.
fun revertBlock(lines: List<DiffLine>, k: Int): String {
    val out = ArrayList<String>()
    var block = -1
    var inBlock = false
    for (l in lines) {
        if (l.mark == ' ') { inBlock = false; out += l.text; continue }
        if (!inBlock) { block++; inBlock = true }
        if (l.mark == (if (block == k) '-' else '+')) out += l.text
    }
    return out.joinToString("\n")
}

fun revertTitle(path: String) = "Revert ${path.substringAfterLast('/')}?"
const val REVERT_DETAIL = "The file goes back to its last commit, or is deleted when it is new. This cannot be undone."

// The composer text for a comment on a diff line, quoting where it is and what it says.
fun commentPrompt(path: String, row: DiffRow, comment: String): String {
    val where = if (row.line.mark == '-') "$path:${row.no} (removed line)" else "$path:${row.no}"
    return "$where\n> ${row.line.text}\n\n${comment.trim()}"
}

fun appendPrompt(draft: String, prompt: String) = if (draft.isBlank()) prompt else draft.trimEnd() + "\n\n" + prompt

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

// shared: server/src/workspace/git.ts branchDiff, the commits this branch made since the default branch.
@Serializable data class BranchFile(val path: String, val add: Int = 0, val del: Int = 0)
@Serializable data class BranchDiff(val base: String = "", val files: List<BranchFile> = emptyList(), val diff: String = "")

fun parseBranchDiff(body: String): BranchDiff = protocolJson.decodeFromString(BranchDiff.serializer(), body)

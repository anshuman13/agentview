package no.pradhan.agentview.nativeapp.workspace

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

@Serializable data class PrFile(val path: String, val additions: Int = 0, val deletions: Int = 0)
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

// shared: server/src/workspace/git.ts branchDiff, the commits this branch made since the default branch.
@Serializable data class BranchDiff(val base: String = "", val files: List<PrFile> = emptyList(), val diff: String = "")

fun parseBranchDiff(body: String): BranchDiff = protocolJson.decodeFromString(BranchDiff.serializer(), body)

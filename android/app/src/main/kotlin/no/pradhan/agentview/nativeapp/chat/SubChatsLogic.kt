package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.Round
import no.pradhan.agentview.nativeapp.net.SubChat
import no.pradhan.agentview.nativeapp.net.SubChatCommit

// Web chat/transcript/subChatsLogic.ts: the text of the earlier sub-chat rows.
const val FOLD_AT = 5

data class Brief(val n: Int, val of: Int, val spec: String)

private val BRIEF = Regex("""^Build run, task (\d+) of (\d+)\. Read (\S+)""")

fun parseBrief(prompt: String): Brief? = BRIEF.find(prompt.trim())?.let { Brief(it.groupValues[1].toInt(), it.groupValues[2].toInt(), it.groupValues[3]) }

private val TASKS_HEAD = Regex("""^## Tasks\s*$""", RegexOption.MULTILINE)
private val NEXT_HEAD = Regex("""^## """, RegexOption.MULTILINE)
private val TASK_LINE = Regex("""^\s*- \[[ x~]\] (.+)$""", setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE))

fun specTasks(md: String): List<String> {
    val parts = md.split(TASKS_HEAD)
    val section = if (parts.size > 1) parts[1].split(NEXT_HEAD)[0] else md
    return TASK_LINE.findAll(section).map { it.groupValues[1].trim() }.toList()
}

private fun oneLine(text: String) = text.replace(Regex("""(^|\s)@\S+"""), "$1").replace(Regex("""\s+"""), " ").trim()

fun subChatTitle(prompt: String, tasks: List<String>? = null): String {
    val brief = parseBrief(prompt) ?: return oneLine(prompt).ifEmpty { "Untitled" }
    val task = tasks?.getOrNull(brief.n - 1)
    return "Task ${brief.n} of ${brief.of}" + (task?.let { ": $it" } ?: "")
}

fun roundText(r: Round?) = if (r == null) "" else "${r.outcome}: ${r.line}"

fun commitText(c: SubChatCommit?) = if (c == null) "" else "${c.hash.take(7)} ${c.subject}"

fun subChatRow(s: SubChat, tasks: List<String>? = null) =
    listOf(subChatTitle(s.title, tasks), roundText(s.round), commitText(s.commit)).filter { it.isNotEmpty() }

data class Folded<T>(val shown: List<T>, val hidden: Int)

fun <T> foldRows(rows: List<T>, unfolded: Boolean): Folded<T> =
    if (unfolded || rows.size <= FOLD_AT) Folded(rows, 0) else Folded(rows.takeLast(FOLD_AT), rows.size - FOLD_AT)

fun chainSpec(subs: List<SubChat>): String? = subs.firstNotNullOfOrNull { parseBrief(it.title)?.spec }

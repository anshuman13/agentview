package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.codex.meetings.peopleOf
import no.pradhan.agentview.nativeapp.codex.meetings.sameName
import no.pradhan.agentview.nativeapp.codex.wiki.keyWords

private fun peopleList(s: String?) = (s ?: "").split(",").map { it.trim() }.filter { it.isNotEmpty() }.distinct()

private fun relatedAt(r: Row) = if (r.table == "meetings") r.startsAt ?: 0 else r.updatedAt

// Mirrors relatedToTask of web/src/codex/data/ask/search.ts, checked by shared/fixtures/related-to-task.json.
// Past meetings and Slack chats of the saved task's profile: two shared title key words, or one plus a shared person. Most shared first, then newest (meeting start, Slack updated_at).
fun relatedToTask(items: List<Row>, meetings: List<Row>, task: Row, now: Long, max: Int = 5): List<Row> {
    val words = keyWords(task.title ?: "")
    if (words.isEmpty()) return emptyList()
    val sources = listOf(
        liveRows(meetings).filter { it.profile == task.profile }.map { it to listOf(it.title, it.str("notes"), it.str("summary"), it.str("decisions")) },
        items.filter { !it.deleted && it.profile == task.profile && it.source == "slack" && !it.sourceUrl.isNullOrEmpty() }.map { it to listOf(it.title, it.text, it.people) },
    )
    val n = LinkedHashMap<String, Pair<Row, Int>>()
    for (source in sources) {
        val indexed = source.map { (r, texts) -> r to keyWords(texts.joinToString(" ") { it ?: "" }) }
        for (w in words) for ((r, ws) in indexed) if (w in ws) n[r.table + r.key] = r to (n[r.table + r.key]?.second ?: 0) + 1
    }
    val mine = peopleList(task.people)
    return n.values.filter { (r, c) ->
        val meeting = r.table == "meetings"
        when {
            !meeting && r.id == task.id -> false
            if (meeting) relatedAt(r) > now else !r.str("meeting_id").isNullOrEmpty() -> false
            else -> c >= 2 || mine.any { p -> (if (meeting) peopleOf(r) else peopleList(r.people)).any { sameName(p, it) } }
        }
    }.sortedWith(compareByDescending<Pair<Row, Int>> { it.second }.thenByDescending { relatedAt(it.first) }).take(max).map { it.first }
}

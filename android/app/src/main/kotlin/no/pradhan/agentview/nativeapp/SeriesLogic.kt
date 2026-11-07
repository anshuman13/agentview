package no.pradhan.agentview.nativeapp

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer

// web/src/codex/data/meetings.ts: a recurring series, and the questions the meetings left open.
fun seriesKey(profile: String, title: String) = "$profile\n$title"

fun parseSeriesKey(key: String): Pair<String, String> {
    val i = key.indexOf('\n')
    return key.substring(0, i) to key.substring(i + 1)
}

fun seriesKeyOf(m: Row) = seriesKey(m.profile, seriesTitle(m.title))

// Live meetings of the series that have started, newest first.
fun seriesMeetings(meetings: List<Row>, profile: String, title: String, now: Long): List<Row> {
    val inside = inSeries(meetings)
    return liveRows(meetings).filter { it.profile == profile && it.key in inside && it.startsAt!! <= now && seriesTitle(it.title) == title }.sortedByDescending { it.startsAt }
}

fun nextInSeries(meetings: List<Row>, profile: String, title: String, now: Long): Row? {
    val inside = inSeries(meetings)
    return liveRows(meetings).filter { it.profile == profile && it.key in inside && it.startsAt!! > now && seriesTitle(it.title) == title }.minByOrNull { it.startsAt!! }
}

private val CADENCES = listOf(Triple(0, 2, "Daily"), Triple(5, 9, "Weekly"), Triple(12, 16, "Every 2 weeks"), Triple(26, 35, "Monthly"))

// The usual gap between consecutive occurrences, or null when it is irregular or there is only one.
fun cadenceOf(members: List<Row>): String? {
    val times = members.map { it.startsAt!! }.sorted()
    val gaps = times.zipWithNext { a, b -> (b - a).toDouble() / DAY_MS }.sorted()
    if (gaps.isEmpty()) return null
    val mid = gaps.size shr 1
    val days = Math.round(if (gaps.size % 2 == 1) gaps[mid] else (gaps[mid - 1] + gaps[mid]) / 2).toInt()
    return CADENCES.firstOrNull { days >= it.first && days <= it.second }?.third
}

fun seriesPeople(members: List<Row>): List<String> = members.flatMap { peopleOf(it) }.fold(emptyList()) { all, p -> if (all.any { sameName(p, it) }) all else all + p }

// Open actions of every occurrence, oldest meeting first, each with the meeting it came from.
fun openAcrossSeries(items: List<Row>, members: List<Row>): List<Pair<Row, Row>> {
    val by = members.associate { it.id to ArrayList<Row>() }
    for (r in items) if (!r.deleted && r.status == "open" && r.profile == members.firstOrNull()?.profile && r.meetingId != null) by[r.meetingId]?.add(r)
    return members.reversed().flatMap { m -> by.getValue(m.id).sortedBy { it.updatedAt }.map { m to it } }
}

class Question(val text: String, val meeting: Row, val at: Long, val profile: String)

fun questionKey(q: Question) = "${q.profile}:${q.text.lowercase()}"

private val BULLET = Regex("^([-*\u2022]|\\d+[.)])\\s+")
private val LEAD = Regex("^([-*\u2022]|\\d+[.)]|#+)\\s+")
private val SENTENCE = Regex("(?<=[.!?])\\s+(?=[A-Z])")
private val QUESTIONS_HEAD = Regex("^(open )?questions:?$", RegexOption.IGNORE_CASE)

// Sentences ending in "?" and bullets under a "Questions" heading, from summaries and notes. Identical text keeps the newest meeting.
fun openQuestions(meetings: List<Row>, now: Long): List<Question> {
    val found = LinkedHashMap<String, Question>()
    for (m in liveRows(meetings)) {
        val at = m.startsAt ?: m.updatedAt
        if (at > now) continue
        for (text in listOf(m.str("summary"), m.str("notes"))) {
            var under = false
            for (raw in (text ?: "").split('\n')) {
                val line = raw.trim()
                if (line.isEmpty()) continue
                val bullet = BULLET.containsMatchIn(line)
                val plain = line.replace(LEAD, "").replace(Regex("\\*+"), "").replace(Regex("\\S+://\\S+"), "").trim()
                if (!bullet) under = QUESTIONS_HEAD.matches(plain)
                val texts = if (under && bullet) listOf(plain) else plain.split(SENTENCE).filter { it.endsWith("?") }
                for (t in texts.map { it.trim() }.filter { it.length > 1 }) {
                    val q = Question(t, m, at, m.profile)
                    val k = questionKey(q)
                    if (k !in found || found.getValue(k).at < at) found[k] = q
                }
            }
        }
    }
    return found.values.sortedByDescending { it.at }
}

private val keysSer = ListSerializer(String.serializer())
fun parseResolved(text: String?): List<String> = runCatching { protocolJson.decodeFromString(keysSer, text ?: "[]") }.getOrDefault(emptyList())
fun encodeResolved(keys: List<String>): String = protocolJson.encodeToString(keysSer, keys)

// Resolve hides a question for good and forgets keys whose question is gone.
fun withResolved(resolved: List<String>, q: Question, meetings: List<Row>, now: Long): List<String> {
    val live = openQuestions(meetings, now).map(::questionKey).toSet()
    return (resolved + questionKey(q)).distinct().filter { it in live }
}

fun visibleQuestions(questions: List<Question>, resolved: List<String>) = questions.filter { questionKey(it) !in resolved }

// The lines of a summary that can be pinned, list markers and emphasis removed.
fun summaryLines(summary: String?): List<String> = (summary ?: "").lines().map { it.trim().replace(LEAD, "").replace(Regex("\\*+"), "").trim() }.filter { it.isNotEmpty() }

// Earlier meetings of the same recurring series: equal series title and at least half of the smaller guest list in common. Newest first.
fun seriesOf(meetings: List<Row>, m: Row): List<Row> {
    val title = seriesTitle(m.title)
    val start = m.startsAt
    if (title.isEmpty() || start == null) return emptyList()
    val people = peopleOf(m)
    return liveRows(meetings).filter { x -> x.profile == m.profile && x.id != m.id && (x.startsAt ?: Long.MAX_VALUE) < start && seriesTitle(x.title) == title && sharesGuests(people, peopleOf(x)) }.sortedByDescending { it.startsAt }
}

class Repeats(val decisions: List<String>, val questions: List<String>)

// What a meeting repeats from the previous one in its series: decisions made again and questions still being asked.
fun seriesRepeats(m: Row, prev: Row, now: Long): Repeats {
    val before = jsonList(prev.str("decisions")).map { it.trim().lowercase() }.toSet()
    val asked = openQuestions(listOf(prev), now).map { it.text.lowercase() }
    return Repeats(
        jsonList(m.str("decisions")).filter { it.isNotBlank() && it.trim().lowercase() in before },
        openQuestions(listOf(m), now).map { it.text }.filter { t -> asked.any { a -> t.lowercase().contains(a) || a.contains(t.lowercase()) } },
    )
}

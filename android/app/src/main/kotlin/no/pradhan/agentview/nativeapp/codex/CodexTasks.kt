package no.pradhan.agentview.nativeapp.codex


// web/src/codex/data/engine.ts split, Codex.tsx day groups and the item helpers around them.
class Split(
    val overdue: List<Row>, val today: List<Row>, val later: List<Row>,
    val review: List<Row>, val notes: List<Row>, val doneToday: List<Row>,
)

fun matchesProfile(profile: String?, r: Row) = profile == null || r.profile == profile

fun split(items: List<Row>, profile: String?, now: Long): Split {
    val today = dayStart(now)
    val open = ArrayList<Row>(); val review = ArrayList<Row>(); val notes = ArrayList<Row>(); val done = ArrayList<Row>()
    for (r in items) {
        if (r.deleted || !matchesProfile(profile, r)) continue
        when (r.status) {
            "open" -> if (r.source != "calendar") open.add(r)
            "suggested" -> review.add(r)
            "note" -> notes.add(r)
            "done" -> if (r.statusTime >= today) done.add(r)
        }
    }
    open.sortWith(compareBy<Row> { it.at ?: 0L }.thenBy { it.updatedAt })
    return Split(
        overdue = open.filter { it.at != null && it.at!! < today },
        today = open.filter { it.at == null || (it.at!! >= today && it.at!! <= now) },
        later = open.filter { (it.at ?: 0L) > now },
        review = review.sortedByDescending { it.statusTime },
        notes = notes.sortedByDescending { it.updatedAt },
        doneToday = done.sortedByDescending { it.statusTime },
    )
}

class Day(val key: String, val label: String, val day: Long?, val rows: List<Row>)

const val UPCOMING_DAYS = 7

// Rows keep the order they were dragged into; the rest follow by due time.
fun ranked(rows: List<Row>) = rows.sortedWith(compareBy<Row> { it.rank ?: 1_000_000_000_000_000L }.thenBy { it.at ?: 0L })

// A day's tasks sort by part of the day; tasks without a time come first.
fun partOf(r: Row): Int {
    val at = r.at ?: return 0
    val h = hourOf(at)
    return if (h < 12) 1 else if (h < 17) 2 else 3
}

fun dueToday(s: Split, now: Long) = s.today + s.later.filter { it.at!! < dayEnd(now) }

// Today holds everything due before midnight; later tasks follow by day, then Later after a week.
fun taskDays(s: Split, now: Long): List<Day> {
    val endOfDay = dayEnd(now)
    val horizon = dayPlus(now, (UPCOMING_DAYS + 1).toLong())
    val groups = linkedMapOf<String, Pair<Pair<String, Long?>, ArrayList<Row>>>()
    groups["today"] = ("Today" to dayStart(now)) to ArrayList(dueToday(s, now))
    for (r in s.later.filter { it.at!! >= endOfDay }) {
        val at = r.at!!
        val later = at >= horizon
        val day = if (later) null else dayStart(at)
        val key = if (later) "later" else day.toString()
        groups.getOrPut(key) { ((if (later) "Later" else dayHeading(at, now)) to day) to ArrayList() }.second.add(r)
    }
    return groups.map { (key, g) ->
        val rows = if (g.first.second == null) ranked(g.second) else ranked(g.second).sortedBy(::partOf)
        Day(key, g.first.first, g.first.second, rows)
    }
}

fun tagList(tags: String?) = (tags ?: "").split(Regex("\\s+")).filter { it.isNotEmpty() }

private val TAG_RE = Regex("(^|\\s)#([\\p{L}\\d_-]+)")

// "#home call mum #errands" is the title "call mum" with the tags home and errands.
fun takeTags(typed: String): Pair<String, List<String>> =
    typed.replace(TAG_RE, "").replace(Regex("\\s+"), " ").trim() to TAG_RE.findAll(typed).map { it.groupValues[2].lowercase() }.toList()

fun tagTasks(items: List<Row>, tag: String): List<Row> {
    val t = tag.lowercase()
    return items.filter { it.status == "open" && !it.deleted && tagList(it.tags).any { x -> x.lowercase() == t } }
        .sortedWith(compareBy<Row> { it.at ?: Long.MAX_VALUE }.thenBy { it.rank ?: 1_000_000_000_000_000L })
}

fun allTags(items: List<Row>, profile: String?) = items.filter { !it.deleted && it.status == "open" && matchesProfile(profile, it) }
    .flatMap { tagList(it.tags).map(String::lowercase) }.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.map { it.key }

fun taskMatches(r: Row, q: String): Boolean {
    if (listOf(r.title, r.text, r.people).any { it?.lowercase()?.contains(q) == true }) return true
    val tag = (if (q.startsWith("#")) q.drop(1) else q).trim()
    return tag.isNotEmpty() && tagList(r.tags).any { it.contains(tag) }
}

// The tasks the Tasks search lists: every open, review and done-today row that matches, once.
fun searchTasks(s: Split, days: List<Day>, query: String): List<Row> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return emptyList()
    return (s.overdue + days.flatMap { it.rows } + s.review + s.doneToday).filter { taskMatches(it, q) }.distinctBy { it.key }
}

fun isRepeat(text: String?) = text != null && Regex("^\\s*Repeats:").containsMatchIn(text)

fun firstLine(text: String?) = text?.lineSequence()?.firstOrNull { it.isNotBlank() }?.trim() ?: ""

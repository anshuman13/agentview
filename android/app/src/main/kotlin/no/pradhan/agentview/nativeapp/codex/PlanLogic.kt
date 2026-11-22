package no.pradhan.agentview.nativeapp.codex

// shared/plan.ts packDay and planToday: slots for today's estimated tasks in the free work gaps.
internal const val SLOT_MS = 5 * 60_000L

internal fun toSlot(t: Long) = (t + SLOT_MS - 1) / SLOT_MS * SLOT_MS

// True when a due time has a time of day; 09:00 sharp is how a date-only due is stored.
fun hasTime(at: Long?) = at != null && !(hourOf(at) == MORNING && minuteOf(at) == 0)

class PlanTask(val row: Row, val due: Long?, val timed: Boolean = false, val goal: Boolean = false) { val title get() = row.title }

class PlanSlot(val task: PlanTask, val span: Span)

// Places tasks into the gaps, tasks linked to a weekly goal first, then in due time order, then list order, each at the first
// gap start (rounded up to 5 minutes) with room for its whole estimate or 30 minutes; tasks that fit nowhere are left out.
fun packDay(tasks: List<PlanTask>, gaps: List<Span>): List<PlanSlot> {
    val free = gaps.map { longArrayOf(it.first, it.second) }
    val order = tasks.withIndex().sortedWith(compareBy({ if (it.value.goal) 0 else 1 }, { it.value.due ?: Long.MAX_VALUE }, { it.index }))
    val out = ArrayList<PlanSlot>()
    for ((_, task) in order) {
        val len = taskMinutes(task.title) * 60_000
        for (g in free) {
            val start = toSlot(g[0])
            if (start + len > g[1]) continue
            out.add(PlanSlot(task, start to start + len))
            g[0] = start + len
            break
        }
    }
    return out
}

// Slots for the tasks with a "~30m" estimate, in due time order, in today's work gaps from now around busy spans.
// Tasks with a set time of day stay where they are: from their due time for their estimate or 30 minutes they are busy.
fun planToday(tasks: List<PlanTask>, busy: List<Span>, now: Long): List<PlanSlot> {
    val set = tasks.filter { it.timed && it.due != null }
    val held = set.map { it.due!! to it.due + taskMinutes(it.title) * 60_000 }
    return packDay(tasks.filter { it !in set && estimateMinutes(it.title) != null }, workGaps(busy + held, now, 8, 17))
}

private val WORD_RE = Regex("\\p{L}{3,}|\\d+")

private fun titleWords(title: String?) = WORD_RE.findAll((title ?: "").replaceFirst(EST_RE, "").lowercase()).map { it.value }.toSet()

// shared/plan.ts suggestEstimate: the average actual minutes of done tasks whose titles share at least half their words with
// title, rounded to 5 minutes; null when fewer than 2 such tasks have actual minutes.
fun suggestEstimate(title: String?, rows: List<Row>): Long? {
    val mine = titleWords(title)
    if (mine.isEmpty()) return null
    val mins = rows.mapNotNull { r ->
        val spent = r.str("spent")?.toDoubleOrNull()?.takeIf { it > 0 }
        if (r.status != "done" || spent == null) return@mapNotNull null
        val theirs = titleWords(r.title)
        spent.takeIf { mine.count { it in theirs } * 2 >= maxOf(mine.size, theirs.size) }
    }
    if (mins.size < 2) return null
    return maxOf(5L, Math.round(mins.average() / 5) * 5)
}

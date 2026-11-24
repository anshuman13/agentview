package no.pradhan.agentview.nativeapp.codex

// shared/sameEvent.ts: one calendar event that arrived twice, by id or at the same time with a reworded title, shows once.
private val WORD = Regex("[\\p{L}\\p{N}]+")

private fun words(t: String?) = WORD.findAll((t ?: "").lowercase()).map { it.value }.toSet()

fun sameEvent(a: Row, b: Row): Boolean {
    if (a.id == b.id) return true
    if (a.startsAt == null || a.startsAt != b.startsAt || a.endsAt != b.endsAt) return false
    val x = words(a.title)
    val y = words(b.title)
    val shared = x.count { it in y }
    return shared > 0 && shared >= 0.6 * minOf(x.size, y.size)
}

fun uniqueEvents(rows: List<Row>): List<Row> {
    val kept = ArrayList<Row>()
    for (r in rows) if (kept.none { sameEvent(it, r) }) kept.add(r)
    return kept
}

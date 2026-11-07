package no.pradhan.agentview.nativeapp

// web/src/codex/useActions.ts: each action edits through the store and offers one undo.
private val UNROLL = mapOf("rolls" to null, "rolled_from" to null)

// A reschedule to a future day starts over, so it clears the rollover history.
fun unrollFor(at: Long?, now: Long): Map<String, Any?> = if (at != null && at >= dayEnd(now)) UNROLL else emptyMap()

private fun Row.col(k: String): Any? = if (k == "deleted") deleted else f[k]

// The notes with the "Repeats:" first line set, replaced or (rule null) removed.
fun withRule(text: String, rule: String?): String {
    val rest = if (isRepeat(text)) text.replaceFirst(Regex("^[^\\n]*\\n?"), "") else text
    return if (rule != null) (if (rest.isNotEmpty()) "$rule\n$rest" else rule) else rest
}

class TaskActions(private val store: CodexStore, private val snack: (String, (() -> Unit)?) -> Unit, private val now: () -> Long = System::currentTimeMillis) {
    private fun change(r: Row, patch: Map<String, Any?>, text: String) {
        val before = patch.keys.associateWith { r.col(it) }
        if (store.update(r, patch)) snack(text) { store.update(r, before) }
    }

    fun done(r: Row) {
        val next = nextRepeat(r, now(), store.state.value.items)
        if (next == null) {
            if (store.update(r, mapOf("status" to "done"))) snack("Done") { store.update(r, mapOf("status" to r.status)) }
            return
        }
        val made = store.capture("${next.title}\n${next.text}", "open", r.profile, next.at)
        if (made == null || !store.update(r, mapOf("status" to "done"))) return
        snack("Done · next ${whenText(next.at, now())}") {
            store.update(r, mapOf("status" to r.status))
            store.update(made, mapOf("deleted" to true))
        }
    }

    fun reopen(r: Row) = change(r, mapOf("status" to "open"), "Moved back to Today")
    fun snooze(r: Row, at: Long) = change(r, mapOf("at" to at) + unrollFor(at, now()), "Snoozed to ${whenText(at, now())}")
    fun tomorrow(r: Row) { val at = nextNine(now(), r.profile); change(r, mapOf("at" to at, "rolls" to null, "rolled_from" to null), "Moved to ${whenText(at, now())}") }
    fun snoozeLater(r: Row) = snooze(r, snoozeLaterAt(r.at, now(), r.profile))
    fun due(r: Row, at: Long?) = change(r, mapOf("at" to at) + unrollFor(at, now()), if (at == null) "Due time cleared" else "Due ${whenText(at, now())}")
    fun delete(r: Row) = change(r, mapOf("deleted" to true), "Deleted")
    fun accept(r: Row) = change(r, mapOf("status" to "open"), "Added to Today")
    fun restore(r: Row) = change(r, mapOf("status" to "suggested"), "Back to review")
    fun dismiss(r: Row) = change(r, mapOf("status" to "dismissed"), "Dismissed")
    fun undoable(text: String, undo: () -> Unit) = snack(text, undo)
    fun edit(r: Row, patch: Map<String, Any?>) { store.update(r, patch) }

    // Overdue tasks move to today at their own time of day, with one undo for all of them.
    fun moveToToday(rows: List<Row>) {
        val t = now()
        val before = rows.map { r -> r to mapOf("at" to r.at, "rolls" to r.rolls, "rolled_from" to r.f["rolled_from"]) }
        var any = false
        for (r in rows) any = store.update(r, mapOf("at" to todayAt(r.at, t)) + UNROLL) || any
        if (any) snack("Moved ${rows.size} to Today") { before.forEach { (r, prev) -> store.update(r, prev) } }
    }

    fun move(r: Row, to: String) {
        if (!store.move(r, to)) return
        snack("Moved to ${if (to == WORK) "Work" else "Personal"}") {
            val there = store.state.value.items.firstOrNull { it.profile == to && it.id == r.id } ?: r.copy(profile = to)
            store.move(there, r.profile)
        }
    }
}

package no.pradhan.agentview.nativeapp.codex

import kotlinx.serialization.json.JsonNull
import no.pradhan.agentview.nativeapp.ui.plural

// web/src/codex/useActions.ts: each action edits through the store and offers one undo.
private val UNROLL = mapOf("rolls" to null, "rolled_from" to null)

// A reschedule to a future day starts over, so it clears the rollover history.
fun unrollFor(at: Long?, now: Long): Map<String, Any?> = if (at != null && at >= dayEnd(now)) UNROLL else emptyMap()

private fun Row.col(k: String): Any? = if (k == "deleted") deleted else f[k]

// web codex/meetings/ActionRow.tsx: at this many rolls a task goes back to review, and accepting it clears its rolls.
private const val STALE_ROLLS = 3

private fun acceptPatch(r: Row): Map<String, Any?> = mapOf<String, Any?>("status" to "open") + if ((r.rolls ?: 0) >= STALE_ROLLS) UNROLL else emptyMap()

// The notes with the "Repeats:" first line set, replaced or (rule null) removed.
fun withRule(text: String, rule: String?): String {
    val rest = if (isRepeat(text)) text.replaceFirst(Regex("^[^\\n]*\\n?"), "") else text
    return if (rule != null) (if (rest.isNotEmpty()) "$rule\n$rest" else rule) else rest
}

enum class BulkKind { Done, Tomorrow, Snooze, Delete }

private class Applied(val row: Row, val patch: Map<String, Any?>, val before: Map<String, Any?>, val made: Row?)

private fun Row.matches(patch: Map<String, Any?>) = patch.all { (k, v) -> if (k == "deleted") deleted == (v == true) else (f[k] ?: JsonNull) == toJson(v) }

fun movedToTodayText(n: Int) = if (n == 1) "Moved to Today" else "Moved $n to Today"

const val NOTED ="Saved as a note"
const val NOTE_FAILED = "Could not save the note. The item is still here."

class TaskActions(private val store: CodexStore, private val snack: (String, (() -> Unit)?) -> Unit, private val now: () -> Long = System::currentTimeMillis) {
    fun change(r: Row, patch: Map<String, Any?>, text: String) {
        val before = patch.keys.associateWith { r.col(it) }
        if (store.update(r, patch)) snack(text) { store.update(r, before) }
    }

    fun create(r: Row, text: String) {
        if (store.add(r)) snack(text) { store.update(r, mapOf("deleted" to true)) }
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

    fun toTask(r: Row) = change(r, mapOf("status" to "open") + unrollFor(r.at, now()), "Moved to Today")
    fun reopen(r: Row) = change(r, mapOf("status" to "open"), "Moved back to Today")
    fun logTime(r: Row, minutes: Long) = change(r, mapOf("spent" to (r.long("spent") ?: 0L) + minutes), "Logged ${minutesText(minutes)}")
    fun snooze(r: Row, at: Long) = change(r, mapOf("at" to at) + unrollFor(at, now()), "Snoozed to ${whenText(at, now())}")
    fun tomorrow(r: Row) { val at = nextNine(now(), r.profile); change(r, mapOf("at" to at, "rolls" to null, "rolled_from" to null), "Moved to ${whenText(at, now())}") }
    fun snoozeLater(r: Row) = snooze(r, snoozeLaterAt(r.at, now(), r.profile))
    fun due(r: Row, at: Long?) = change(r, mapOf("at" to at) + unrollFor(at, now()), if (at == null) "Due time cleared" else "Due ${whenText(at, now())}")
    fun clear(rows: List<Row>) {
        val done = rows.filter { store.update(it, mapOf("deleted" to true)) }
        if (done.isNotEmpty()) snack("Cleared ${done.size}") { done.forEach { store.update(it, mapOf("deleted" to false)) } }
    }

    // One action on every selected task with one snack and one undo; undo skips a row edited since.
    fun bulk(rows: List<Row>, kind: BulkKind) {
        val t = now()
        val applied = ArrayList<Applied>()
        for (r in rows) {
            var made: Row? = null
            val patch = when (kind) {
                BulkKind.Done -> {
                    val next = nextRepeat(r, t, store.state.value.items)
                    if (next != null) made = store.capture("${next.title}\n${next.text}", "open", r.profile, next.at) ?: continue
                    mapOf("status" to "done")
                }
                BulkKind.Tomorrow -> mapOf<String, Any?>("at" to nextNine(t, r.profile)) + UNROLL
                BulkKind.Snooze -> snoozeLaterAt(r.at, t, r.profile).let { mapOf<String, Any?>("at" to it) + unrollFor(it, t) }
                BulkKind.Delete -> mapOf("deleted" to true)
            }
            val before = patch.keys.associateWith { r.col(it) }
            if (store.update(r, patch)) applied.add(Applied(r, patch, before, made)) else made?.let { store.update(it, mapOf("deleted" to true)) }
        }
        val n = applied.size
        if (n == 0) return
        val first = rows.first()
        val text = when (kind) {
            BulkKind.Done -> "Done ${plural(n, "task")}"
            BulkKind.Tomorrow -> "Moved ${plural(n, "task")} to ${whenText(nextNine(t, first.profile), t)}"
            BulkKind.Snooze -> "Snoozed ${plural(n, "task")}"
            BulkKind.Delete -> "Deleted ${plural(n, "task")}"
        }
        snack(text) {
            for (a in applied) {
                val cur = store.current(a.row)
                if (!cur.matches(a.patch)) continue
                store.update(cur, a.before)
                a.made?.let { store.update(it, mapOf("deleted" to true)) }
            }
        }
    }
    fun delete(r: Row) = change(r, mapOf("deleted" to true), "Deleted")
    fun accept(r: Row) = change(r, acceptPatch(r), "Added to Today")
    fun restore(r: Row) = change(r, mapOf("status" to "suggested"), "Back to review")
    fun dismiss(r: Row, text: String = "Dismissed") = change(r, mapOf("status" to "dismissed"), text)
    fun toNote(r: Row) {
        if (store.update(r, mapOf("status" to "note"))) snack(NOTED) { store.update(r, mapOf("status" to "suggested")) } else say(NOTE_FAILED)
    }
    fun addNote(text: String, profile: String) {
        store.capture(text.trim(), "note", profile)
    }
    fun deleteNote(r: Row) = change(r, mapOf("deleted" to true), "Note deleted")
    fun undoable(text: String, undo: () -> Unit) = snack(text, undo)
    fun say(text: String) = snack(text, null)
    fun snoozeAsk(r: Row, until: Long) = change(r, mapOf("snoozed_until" to until), "Snoozed to ${whenText(until, now())}")

    // Dismissing keeps the drafts and sends nothing; one undo restores each row whose status has not changed since.
    fun dismissAll(rows: List<Row>) {
        val done = rows.filter { store.update(it, mapOf("status" to "dismissed")) }
        if (done.isEmpty()) return
        snack("${done.size} dismissed") {
            done.forEach { r -> val cur = store.current(r); if (cur.status == "dismissed") store.update(cur, mapOf("status" to r.status)) }
        }
    }
    fun acceptAll(rows: List<Row>) {
        val done = rows.filter { store.update(it, acceptPatch(it)) }
        if (done.isEmpty()) return
        snack("${done.size} added to Today") {
            done.forEach { r -> val cur = store.current(r); if (cur.status == "open") store.update(cur, acceptPatch(r).keys.associateWith { r.col(it) }) }
        }
    }
    fun edit(r: Row, patch: Map<String, Any?>) { store.update(r, patch) }

    // Overdue tasks move to today at their own time of day, with one undo for all of them.
    fun moveToToday(rows: List<Row>) {
        val t = now()
        val before = rows.map { r -> r to mapOf("at" to r.at, "rolls" to r.rolls, "rolled_from" to r.f["rolled_from"]) }
        var any = false
        for (r in rows) any = store.update(r, mapOf("at" to todayAt(r.at, t)) + UNROLL) || any
        if (any) snack(movedToTodayText(rows.size)) { before.forEach { (r, prev) -> store.update(r, prev) } }
    }

    fun move(r: Row, to: String) {
        if (!store.move(r, to)) return
        snack("Moved to ${if (to == WORK) "Work" else "Personal"}") {
            val there = store.state.value.items.firstOrNull { it.profile == to && it.id == r.id } ?: r.copy(profile = to)
            store.move(there, r.profile, r.str("goal"))
        }
    }
}

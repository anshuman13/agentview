package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.net.rename
import no.pradhan.agentview.nativeapp.sessions.items
import no.pradhan.agentview.nativeapp.sessions.state

// web/src/codex/GoalsPage.tsx and Goals.tsx: adding, renaming, reopening and removing weekly goals.
fun reopenBlock(items: List<Row>, goal: Row, now: Long): String? {
    val mine = goalsOf(items, now, goal.profile)
    if (mine.size >= MAX_GOALS) return "This week is full ($MAX_GOALS goals)"
    return if (mine.any { titleKey(it.title) == titleKey(goal.title) }) "Already this week" else null
}

fun renameBlocked(items: List<Row>, goal: Row, title: String, now: Long): Boolean =
    goalsOf(items, goal.at ?: now, goal.profile).any { it.id != goal.id && titleKey(it.title) == titleKey(title) }

class GoalActions(private val store: CodexStore, private val snack: (String, (() -> Unit)?) -> Unit, private val now: () -> Long = System::currentTimeMillis) {
    fun add(text: String, profile: String): Boolean {
        val t = text.trim().take(120)
        if (t.isEmpty() || goalsOf(store.state.value.items, now(), profile).size >= MAX_GOALS) return false
        return store.capture(t, GOAL, profile, weekStart(now())) != null
    }

    fun rename(g: Row, title: String) {
        val t = title.trim().take(120)
        if (t.isEmpty() || t == g.title) return
        if (renameBlocked(store.state.value.items, g, t, now())) { snack("Already a goal that week", null); return }
        store.update(g, mapOf("title" to t))
    }

    fun move(g: Row, at: Long?) = store.update(g, mapOf("at" to at))

    fun reopen(g: Row) {
        if (store.capture(g.title ?: "", GOAL, g.profile, weekStart(now())) != null) snack("Goal reopened", null)
    }

    fun remove(g: Row) {
        if (store.update(g, mapOf("deleted" to true))) snack("Goal deleted") { store.update(g, mapOf("deleted" to false)) }
    }
}

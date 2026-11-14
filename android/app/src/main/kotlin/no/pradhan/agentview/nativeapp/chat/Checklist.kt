package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateMapOf
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import no.pradhan.agentview.nativeapp.net.ChatEvent

// Port of shared/todos.ts: Claude's TodoWrite list, shown as a card above the composer.
@Immutable
data class ChecklistItem(val content: String, val activeForm: String, val status: String)

private val STATUSES = setOf("pending", "in_progress", "completed")

// The list from the newest TodoWrite call of the chat itself (not a sub-agent's); null when Claude has not written one.
fun latestChecklist(events: List<ChatEvent>): List<ChecklistItem>? {
    for (i in events.indices.reversed()) {
        val e = events[i]
        if (e.kind != "tool_use" || e.name != "TodoWrite" || e.parent != null) continue
        val list = e.input["todos"] as? JsonArray ?: return emptyList()
        return list.mapNotNull { t ->
            val o = t as? JsonObject ?: return@mapNotNull null
            val status = o.s("status")
            if ((o["content"] as? JsonPrimitive)?.isString != true || status !in STATUSES) null else ChecklistItem(o.s("content"), o.s("activeForm"), status)
        }
    }
    return null
}

fun checklistDone(items: List<ChecklistItem>) = items.count { it.status == "completed" }

fun checklistProgress(items: List<ChecklistItem>) = "${checklistDone(items)} of ${items.size}"

// What Claude is on: the in-progress item, else the first one still to do.
fun checklistCurrent(items: List<ChecklistItem>): String {
    val t = items.firstOrNull { it.status == "in_progress" } ?: items.firstOrNull { it.status == "pending" }
    return t?.activeForm?.ifEmpty { t.content } ?: ""
}

// Hidden when the list is empty, or finished and the turn has ended.
fun visibleChecklist(items: List<ChecklistItem>?, running: Boolean) = items?.takeIf { it.isNotEmpty() && (running || checklistDone(it) < it.size) }

private val cardChoices = mutableStateMapOf<String, Boolean>()

// Web chat/cards/useCardOpen.ts: a card is closed until tapped, opens itself while it needs you and then stays as the last tap left it; kept in memory per chat and card.
@Composable
fun rememberCardOpen(key: String, needsYou: Boolean): Pair<Boolean, () -> Unit> {
    LaunchedEffect(key, needsYou) {
        val chat = key.substringBeforeLast(':')
        cardChoices.keys.removeAll { !it.startsWith("$chat:") }
        if (needsYou && key !in cardChoices) cardChoices[key] = true
    }
    val open = cardChoices[key] ?: needsYou
    return open to { cardChoices[key] = !open }
}

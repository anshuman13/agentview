package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.Immutable
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.ops.buildAgents
import no.pradhan.agentview.nativeapp.sessions.items

const val TOKEN_BATCH_MS = 32L

// A chat's transcript and everything the chat screens derive from it, built once per change.
@Immutable
class ChatView(
    val chat: String,
    val events: List<ChatEvent>,
    val items: List<Item>,
    val agents: List<Agent>,
    val cost: Double,
    val images: List<String>,
    val changed: List<String>,
    val rewinds: Set<String>,
    val runs: Map<String, List<Item.Step>>,
    val days: Map<String, String>,
    val dayOf: Map<String, String>,
    val ats: Map<String, Long>,
    val sent: Int,
    val checklist: List<ChecklistItem>?,
) {
    // Newest first, the order the reversed list draws.
    val rows: List<Item> = items.asReversed()

    fun withItems(events: List<ChatEvent>, items: List<Item>) = ChatView(chat, events, items, agents, cost, images, changed, rewinds, runs, days, dayOf, ats, sent, checklist)

    companion object {
        val EMPTY = buildView("", emptyList(), 0L, null)
    }
}

fun buildView(chat: String, events: List<ChatEvent>, now: Long, prev: ChatView?): ChatView {
    val built = buildTranscript(events)
    val before = if (prev?.chat == chat) prev.items.associateBy { it.id } else emptyMap()
    val items = built.map { b -> before[b.id]?.takeIf { it == b } ?: b }
    val days = dayDividers(items, now)
    return ChatView(
        chat, events, items, buildAgents(events, items), chatCost(events), chatImages(events),
        items.filterIsInstance<Item.File>().filter { it.error == null }.map { it.path }.distinct(),
        rewindable(items), exploreRuns(items), days, dayOfRows(items, days),
        events.associate { it.id to it.at }, items.count { it is Item.User }, latestChecklist(events),
    )
}

// A streamed token only changes the text of one reply: every other item, and all that is derived from the rows, stays.
private fun patched(prev: ChatView, events: List<ChatEvent>): ChatView? {
    if (events.size != prev.events.size) return null
    var at = -1
    for (i in events.indices) if (events[i] !== prev.events[i]) { if (at >= 0) return null; at = i }
    if (at < 0) return prev
    val old = prev.events[at]
    val new = events[at]
    if (old.kind != "assistant" || new.kind != "assistant" || new.parent != null || new.id != old.id || new.at != old.at) return null
    val text = stripRound(new.text)
    val row = prev.items.indexOfFirst { it.id == new.id }
    if (text.isBlank() || row < 0 || prev.items[row] !is Item.Assistant) return null
    return prev.withItems(events, prev.items.toMutableList().also { it[row] = Item.Assistant(new.id, text, new.streaming) })
}

fun nextView(prev: ChatView, chat: String, events: List<ChatEvent>, now: Long): ChatView =
    (if (prev.chat == chat) patched(prev, events) else null) ?: buildView(chat, events, now, prev)

// Builds the view of the shown chat off the main thread. Updates of a chat that is already showing rows are batched to one per TOKEN_BATCH_MS.
class TranscriptFeed(
    source: Flow<Pair<String, List<ChatEvent>>>,
    scope: CoroutineScope,
    context: CoroutineContext = Dispatchers.Default,
    private val batchMs: Long = TOKEN_BATCH_MS,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _view = MutableStateFlow(ChatView.EMPTY)
    val view: StateFlow<ChatView> = _view

    init {
        scope.launch(context) {
            source.conflate().collect { (chat, events) ->
                val prev = _view.value
                _view.value = nextView(prev, chat, events, now())
                if (chat == prev.chat && events.isNotEmpty() && prev.events.isNotEmpty()) delay(batchMs)
            }
        }
    }
}

package no.pradhan.agentview.nativeapp.chat

// Replies that start streaming while their chat is showing. Ids seen before are known; known stays null until the
// transcript first shows items, so a chat opened mid-reply has none. take hands an id out once, so a row recreated on
// scroll back is not fresh again.
class FreshReplies {
    private var known: MutableSet<String>? = null
    private val pending = mutableSetOf<String>()

    fun update(items: List<Item>) {
        val k = known
        if (k != null) for (it in items) if (it is Item.Assistant && it.streaming && it.id !in k) pending += it.id
        if (items.isNotEmpty()) (k ?: mutableSetOf<String>().also { known = it }).addAll(items.map { it.id })
    }

    fun take(id: String) = pending.remove(id)
}

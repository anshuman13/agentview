package no.pradhan.agentview.nativeapp.sessions

data class UnreadChat(val id: String, val state: ChatState?, val lastActive: Long)

// The chats to jump to from the end of a chat: Needs you, then Done, each newest first, without the one in view; web chatNav.ts unreadOrder says the same.
fun unreadOrder(chats: List<UnreadChat>, viewing: String): List<String> =
    listOf(ChatState.Needs, ChatState.Done).flatMap { s -> chats.filter { it.id != viewing && it.state == s }.sortedByDescending { it.lastActive }.map { it.id } }

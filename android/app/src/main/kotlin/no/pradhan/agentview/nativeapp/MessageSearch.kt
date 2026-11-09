package no.pradhan.agentview.nativeapp

import kotlinx.serialization.Serializable

@Serializable
data class MessageHit(val sessionId: String, val role: String, val text: String, val at: String = "", val title: String = "", val cwd: String = "")

// Searching every chat's prompts and replies starts at 3 characters.
fun messageQuery(filter: String): String? = filter.trim().takeIf { it.length >= 3 }

fun messageMeta(h: MessageHit, now: Long): String =
    listOf(h.title.ifBlank { "Untitled" }, if (h.role == "user") "You" else "Claude", agoShort(isoMillis(h.at), now)).filter { it.isNotEmpty() }.joinToString(" · ")

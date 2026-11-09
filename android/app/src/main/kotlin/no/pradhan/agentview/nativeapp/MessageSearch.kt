package no.pradhan.agentview.nativeapp

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import kotlinx.serialization.Serializable

@Serializable
data class MessageHit(val sessionId: String, val role: String, val text: String, val at: String = "", val title: String = "", val cwd: String = "")

// Searching every chat's prompts and replies starts at 3 characters.
fun messageQuery(filter: String): String? = filter.trim().takeIf { it.length >= 3 }

fun messageMeta(h: MessageHit, now: Long): String =
    listOf(h.title.ifBlank { "Untitled" }, if (h.role == "user") "You" else "Claude", agoShort(isoMillis(h.at), now)).filter { it.isNotEmpty() }.joinToString(" · ")

// The hit text with each word of the query in bold, ignoring case.
fun boldMatches(text: String, query: String): AnnotatedString = buildAnnotatedString {
    append(text)
    val low = text.lowercase()
    query.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }.forEach { w ->
        var i = low.indexOf(w)
        while (i >= 0) { addStyle(SpanStyle(fontWeight = FontWeight.Bold), i, i + w.length); i = low.indexOf(w, i + w.length) }
    }
}

package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.LiveChat

enum class VoicePhase { Listening, Thinking, Speaking, Paused, Done, Failed }

data class VoiceState(val phase: VoicePhase, val heard: String = "", val answer: String = "", val error: String = "")

const val VOICE_RULES = "(Spoken question. Answer in at most three short sentences of plain text, no markdown or lists. Only read and summarise. Do not send prompts to any chat and do not change anything.)"

// The question with the open chats and the rules a spoken answer needs, sent through the same path as the Codex ask bar.
fun voicePrompt(question: String, chats: List<LiveChat>): String {
    val lines = chats.take(30).joinToString("\n") { c ->
        val state = when { c.pending > 0 -> "needs me"; c.running -> "working"; c.failed -> "failed"; else -> "idle" }
        "- ${c.title.ifBlank { "Untitled" }}: $state"
    }
    return listOfNotNull(question, if (lines.isNotEmpty()) "\nMy open chats:\n$lines" else null, "\n$VOICE_RULES").joinToString("\n")
}

// The finished answer to the question, or null while Claude is still writing or working.
fun voiceAnswer(events: List<ChatEvent>, question: String, before: Int = 0, busy: Boolean = false): String? {
    if (busy) return null
    if (events.count { it.kind == "user" && it.text.startsWith(question) } <= before) return null
    val asked = events.indexOfLast { it.kind == "user" && it.text.startsWith(question) }
    val after = events.drop(asked + 1)
    if (after.any { it.kind == "assistant" && it.streaming }) return null
    return after.lastOrNull { it.kind == "assistant" && it.text.isNotBlank() }?.text?.trim()
}

private val FENCE = Regex("```.*?```", RegexOption.DOT_MATCHES_ALL)
private val LINK = Regex("\\[([^\\]]*)]\\([^)]*\\)")
private val MARKS = Regex("(?m)^\\s*(#{1,6}|>|[-*+]|\\d+\\.)\\s+|[*_`~]+")

fun spokenText(markdown: String, max: Int = 900): String {
    val plain = markdown.replace(FENCE, " ").replace(LINK, "$1").replace(MARKS, "").replace(Regex("\\s+"), " ").trim()
    return if (plain.length <= max) plain else plain.take(max).substringBeforeLast(' ') + "."
}

// Sentences of at most `max` characters, so Pause can stop between them.
fun speechChunks(text: String, max: Int = 200): List<String> {
    val out = mutableListOf<String>()
    var cur = ""
    Regex("[^.!?]+[.!?]*\\s*").findAll(text).map { it.value.trim() }.filter { it.isNotEmpty() }.forEach { s ->
        var rest = s
        while (rest.length > max) {
            val cut = rest.lastIndexOf(' ', max).takeIf { it > 0 } ?: max
            if (cur.isNotEmpty()) { out += cur; cur = "" }
            out += rest.take(cut).trim()
            rest = rest.drop(cut).trim()
        }
        if (cur.isNotEmpty() && cur.length + rest.length + 1 > max) { out += cur; cur = "" }
        cur = if (cur.isEmpty()) rest else "$cur $rest"
    }
    if (cur.isNotEmpty()) out += cur
    return out
}

package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.providerModes

private const val QUOTE_MAX = 80

// web chat/cards/pendingLogic.ts planParagraphs: the plan's blocks split at blank lines, leaving fenced code whole.
fun planParagraphs(plan: String): List<String> {
    val out = mutableListOf<String>()
    var cur = mutableListOf<String>()
    var fence = false
    for (line in plan.lines()) {
        if (line.trimStart().let { it.startsWith("```") || it.startsWith("~~~") }) fence = !fence
        if (!fence && line.isBlank()) {
            if (cur.isNotEmpty()) out += cur.joinToString("\n")
            cur = mutableListOf()
        } else cur += line
    }
    if (cur.isNotEmpty()) out += cur.joinToString("\n")
    return out
}

fun planQuote(paragraph: String): String {
    val flat = paragraph.replace(Regex("\\s+"), " ").trim()
    return "> " + if (flat.length > QUOTE_MAX) flat.take(QUOTE_MAX).trimEnd() + "…" else flat
}

// web planFeedback: one message quoting each commented paragraph, then the comment; empty when there are none.
fun planFeedback(paragraphs: List<String>, notes: Map<Int, String>): String {
    val parts = paragraphs.mapIndexedNotNull { i, p -> notes[i]?.trim()?.takeIf { it.isNotEmpty() }?.let { "${planQuote(p)}\n$it" } }
    return if (parts.isEmpty()) "" else "Comments on the plan:\n\n" + parts.joinToString("\n\n")
}

// web blockedRule: the command of a blocked Bash rule, unescaped; any other rule as it is.
fun blockedRule(rule: String): String =
    if (rule.startsWith("Bash(")) rule.removePrefix("Bash(").removeSuffix(")").replace(Regex("\\\\([\\\\()])"), "$1") else rule

// "Allow and switch to Auto" (web canSwitchToAuto): not for plan approval, not when the mode is unknown (the session list's cards) or already auto, and only where the provider has auto.
fun canSwitchToAuto(tool: String, mode: String, provider: String?) =
    tool != "ExitPlanMode" && mode.isNotEmpty() && mode != "auto" && providerModes(provider).any { it.value == "auto" }

private val PLAN_APPROVE = mapOf("acceptEdits" to "Approve and allow edits", "auto" to "Approve and use Auto")

// web planApproveModes: the plan card's Approve menu, approve and switch to each mode the provider has, not when the mode is unknown (the session list's cards).
fun planApproveModes(mode: String, provider: String?): List<Pair<String, String>> =
    if (mode.isEmpty()) emptyList() else providerModes(provider).mapNotNull { m -> PLAN_APPROVE[m.value]?.let { m.value to it } }

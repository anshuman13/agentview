package no.pradhan.agentview.nativeapp.codex

// shared/ideas.ts: Muse's Ideas for Codex, open tasks an agent could take on, by the verb they start with.
private val AGENT_VERBS = Regex("^(draft|write|research|find|summari[sz]e|prepare|prep|review|check|look up|look into|compare|plan|read|reply|answer|investigate|analy[sz]e|update|fix|outline|collect|gather|list)\\b", RegexOption.IGNORE_CASE)

const val IDEAS_SHOWN = 3

fun canDelegate(title: String?) = AGENT_VERBS.containsMatchIn((title ?: "").trim())

// Dated tasks first, soonest due first, then undated ones; at most IDEAS_SHOWN, skipping the hidden keys.
fun pickIdeas(tasks: List<Row>, hidden: Set<String>): List<Row> =
    tasks.filter { it.status == "open" && canDelegate(it.title) && it.key !in hidden }.sortedBy { it.at ?: Long.MAX_VALUE }.take(IDEAS_SHOWN)

fun ideaTitle(title: String) = "I can help: ${title.replaceFirstChar { it.lowercase() }}"

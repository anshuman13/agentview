package no.pradhan.agentview.nativeapp

// Port of web/src/sessions/agents.ts: the sub-agents of a chat, newest first in the list.
data class Agent(
    val id: String,
    val item: Item.Agent,
    val info: ChatEvent?,
    val description: String,
    val type: String,
    val model: String?,
    val prompt: String,
    val status: String,
    val startedAt: Long,
    val endedAt: Long?,
    val lastStep: String,
    val lastAt: Long,
)

private fun stepText(it: Item?): String = when (it) {
    is Item.Step -> stepLabel(it.use.name, it.use.input).let { l -> listOf(l.verb, l.obj).filter { s -> s.isNotEmpty() }.joinToString(" ") }
    is Item.Agent -> stepLabel(it.use.name, it.use.input).let { l -> listOf(l.verb, l.obj).filter { s -> s.isNotEmpty() }.joinToString(" ") }
    is Item.File -> "Edited ${it.path.substringAfterLast('/')}"
    is Item.Assistant -> firstLine(it.text)
    is Item.System -> firstLine(it.text)
    else -> ""
}

private fun agentOf(it: Item.Agent, info: ChatEvent?, lastAt: Long): Agent {
    val use = it.use
    val result = it.result
    val running = it.running && !(info != null && info.status != "running" && result == null)
    val ended = when {
        result?.stopped == true || isDenied(result) -> "stopped"
        result?.isError == true -> "failed"
        else -> "done"
    }
    return Agent(
        id = use.id,
        item = it,
        info = info,
        description = info?.description?.ifEmpty { null } ?: use.input.s("description").ifEmpty { "Sub-agent" },
        type = info?.subagentType?.ifEmpty { null } ?: use.input.s("subagent_type").ifEmpty { "general-purpose" },
        model = info?.model ?: use.input.s("model").ifEmpty { null },
        prompt = info?.prompt?.ifEmpty { null } ?: use.input.s("prompt"),
        status = if (running) "running" else if (info != null && info.status != "running" && info.status.isNotEmpty()) info.status else ended,
        startedAt = info?.startedAt?.takeIf { it > 0 } ?: use.at,
        endedAt = if (running) null else info?.endedAt ?: result?.at,
        lastStep = stepText(it.steps.lastOrNull()),
        lastAt = maxOf(lastAt, use.at),
    )
}

fun buildAgents(events: List<ChatEvent>): List<Agent> {
    val info = HashMap<String, ChatEvent>()
    val lastAt = HashMap<String, Long>()
    for (e in events) {
        if (e.kind == "agent") info[e.toolUseId] = e
        else if (e.parent != null) lastAt[e.parent] = maxOf(lastAt[e.parent] ?: 0, e.at)
    }
    val out = mutableListOf<Agent>()
    fun walk(items: List<Item>) {
        for (it in items) {
            if (it !is Item.Agent) continue
            out += agentOf(it, info[it.id], lastAt[it.id] ?: 0)
            walk(it.steps)
        }
    }
    walk(buildTranscript(events))
    return out
}

fun reportText(a: Agent): String {
    val r = a.item.result
    if (r != null && r.text.isNotEmpty()) return r.text
    if (a.status == "failed" || a.status == "stopped") return a.info?.progress ?: "Agent ${a.status}"
    return "(no report)"
}

fun elapsed(ms: Long): String {
    val s = maxOf(0L, Math.round(ms / 1000.0))
    return when {
        s < 60 -> "${s}s"
        s < 3600 -> "${s / 60}m ${s % 60}s"
        else -> "${s / 3600}h ${(s % 3600) / 60}m"
    }
}

fun tokensText(n: Long): String = if (n < 1000) "$n tokens" else String.format(java.util.Locale.US, if (n < 10_000) "%.1fk tokens" else "%.0fk tokens", n / 1000.0)

fun agentMeta(a: Agent, now: Long): String = listOfNotNull(
    a.type, a.model, elapsed((a.endedAt ?: now) - a.startedAt),
    a.info?.usage?.let { tokensText(it.tokens) }, a.info?.usage?.let { plural(it.toolUses, "tool use") },
    if (a.info?.background == true) "background" else null,
).joinToString(" · ")

fun agentRowMeta(a: Agent): String = listOf(
    a.status, if (a.item.steps.isNotEmpty()) plural(a.item.steps.size, "step") else "",
    (if (a.status == "running") a.info?.progress else null) ?: a.lastStep,
).filter { it.isNotEmpty() }.joinToString(" · ")

fun agentDot(status: String) = when (status) {
    "running" -> DotState.Running
    "done" -> DotState.Ok
    "failed" -> DotState.Bad
    else -> DotState.Faint
}

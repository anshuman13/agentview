package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.ModelInfo

fun Capabilities.can(what: String) = when (what) {
    "rewind" -> rewind
    "mcp" -> mcp
    "mcpEdit" -> mcpEdit
    "connectors" -> connectors
    "effort" -> effort
    "build" -> build
    "stopTask" -> stopTask
    "subagents" -> subagents
    else -> true
}

// The effort levels the chat's model lists, or all of them when it lists none.
fun effortsFor(models: List<ModelInfo>, model: String?): List<String> {
    val listed = models.firstOrNull { it.value == model }?.efforts
    return if (listed == null) EFFORT_LEVELS else EFFORT_LEVELS.filter { it in listed }
}

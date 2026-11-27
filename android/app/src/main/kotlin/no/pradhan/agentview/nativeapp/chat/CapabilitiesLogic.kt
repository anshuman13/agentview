package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.ModelInfo

fun Capabilities.can(what: String) = when (what) {
    "rewind" -> rewind
    "mcp" -> mcp
    "mcpEdit" -> mcpEdit
    "connectors" -> connectors
    "effort" -> effort
    "stopTask" -> stopTask
    "subagents" -> subagents
    "forkAt" -> forkAt
    "contextUsage" -> contextUsage
    else -> true
}

// The effort levels the chat's model lists, or all of them when it lists none.
fun effortsFor(models: List<ModelInfo>, model: String?): List<String> {
    val row = modelRow(models, model)
    val listed = models.firstOrNull { it.value == row }?.efforts
    return if (listed == null) EFFORT_LEVELS else EFFORT_LEVELS.filter { it in listed }
}

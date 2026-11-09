package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.ModelInfo

fun Capabilities.can(what: String) = when (what) {
    "rewind" -> rewind
    "mcp" -> mcp
    "effort" -> effort
    "team" -> team
    "stopTask" -> stopTask
    else -> true
}

// The Team entry is the Opus advisor setup, which only Claude chats have.
fun modelsFor(models: List<ModelInfo>, caps: Capabilities) = if (caps.team) models else models.filter { it.value != "team" }

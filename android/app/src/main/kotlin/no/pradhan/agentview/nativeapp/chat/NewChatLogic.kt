package no.pradhan.agentview.nativeapp.chat

import kotlinx.serialization.builtins.ListSerializer
import no.pradhan.agentview.nativeapp.net.ModelInfo
import no.pradhan.agentview.nativeapp.net.protocolJson

private val modelList = ListSerializer(ModelInfo.serializer())

fun parseModels(s: String?): List<ModelInfo> = s?.let { runCatching { protocolJson.decodeFromString(modelList, it) }.getOrNull() } ?: emptyList()

fun encodeModels(models: List<ModelInfo>): String = protocolJson.encodeToString(modelList, models)

// The model the sheet starts on: the last one used when the server still offers it, else the first on the list.
fun startModel(models: List<ModelInfo>, last: String?): String? =
    models.firstOrNull { it.value == last }?.value ?: models.firstOrNull()?.value

// The "Start as" choices of the new chat sheet: no mode keeps the chat's default; the others are set once the chat opens.
class StartMode(val label: String, val mode: String?)

val START_MODES = listOf(StartMode("Auto", null), StartMode("Plan first", "plan"), StartMode("Ask first", "default"))

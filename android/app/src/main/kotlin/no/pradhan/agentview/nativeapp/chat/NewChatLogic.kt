package no.pradhan.agentview.nativeapp.chat

import kotlinx.serialization.builtins.ListSerializer
import no.pradhan.agentview.nativeapp.net.ModelInfo
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.workspace.specPrompt

private val modelList = ListSerializer(ModelInfo.serializer())

fun parseModels(s: String?): List<ModelInfo> = s?.let { runCatching { protocolJson.decodeFromString(modelList, it) }.getOrNull() } ?: emptyList()

fun encodeModels(models: List<ModelInfo>): String = protocolJson.encodeToString(modelList, models)

// Claude and OpenRouter share the Claude model aliases; Codex has its own list, so each keeps its own models and last model.
fun modelGroup(provider: String?) = if (provider == "codex") "codex" else "claude"

fun modelsKey(group: String) = if (group == "codex") "models:codex" else "models"

fun lastModelKey(group: String) = if (group == "codex") "lastModel:codex" else "lastModel"

// The model the sheet starts on: the last one used when the server still offers it, else the first on the list.
fun startModel(models: List<ModelInfo>, last: String?): String? =
    models.firstOrNull { it.value == last }?.value ?: models.firstOrNull()?.value

// The "Start as" choices of the new chat sheet: no mode keeps the chat's default; the others are set once the chat opens, Spec also puts the spec request prefix in the composer, and Supervised turns on the review of each turn's changes.
class StartMode(val label: String, val mode: String?, val draft: String? = null, val review: Boolean = false)

val START_MODES = listOf(StartMode("Auto", null), StartMode("Plan first", "plan"), StartMode("Ask first", "default"), StartMode("Spec", "plan", specPrompt("")), StartMode("Supervised", "auto", review = true))

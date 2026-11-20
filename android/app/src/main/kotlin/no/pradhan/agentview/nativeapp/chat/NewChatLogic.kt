package no.pradhan.agentview.nativeapp.chat

import kotlinx.serialization.builtins.ListSerializer
import no.pradhan.agentview.nativeapp.net.ModelInfo
import no.pradhan.agentview.nativeapp.net.ProviderOption
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.providerModes
import no.pradhan.agentview.nativeapp.workspace.specPrompt

private val modelList = ListSerializer(ModelInfo.serializer())

fun parseModels(s: String?): List<ModelInfo> = s?.let { runCatching { protocolJson.decodeFromString(modelList, it) }.getOrNull() } ?: emptyList()

fun encodeModels(models: List<ModelInfo>): String = protocolJson.encodeToString(modelList, models)

// The server's model set of a provider (Claude and OpenRouter share one), so each set keeps its own models and last model.
fun modelGroup(provider: String?, options: List<ProviderOption>) = options.firstOrNull { it.id == provider }?.modelSet ?: provider ?: "claude"

// The claude set keeps the keys from before there were sets.
fun modelsKey(group: String) = if (group == "claude") "models" else "models:$group"

fun lastModelKey(group: String) = if (group == "claude") "lastModel" else "lastModel:$group"

// The model the sheet starts on: the last one used when the server still offers it, else none and the server chooses.
fun startModel(models: List<ModelInfo>, last: String?): String? =
    models.firstOrNull { it.value == last }?.value

// The "Start as" choices of the new chat sheet: no mode keeps the chat's default; the others are set once the chat opens, and Spec also puts the spec request prefix in the composer.
class StartMode(val label: String, val mode: String?, val draft: ((String) -> String)? = null)

val START_MODES = listOf(StartMode("Auto", null), StartMode("Plan first", "plan"), StartMode("Spec", "plan", ::specPrompt))

// What the new chat gets: Spec puts the request in the composer after the spec prompt and sends nothing, the others send it as the first message.
fun startTexts(m: StartMode, text: String?): Pair<String?, String?> = m.draft?.let { it(text.orEmpty()) to null } ?: (null to text)

// A start mode the provider does not offer (Plan on Codex) starts in Default.
fun startModeFor(mode: String?, provider: String?) = if (mode != null && providerModes(provider).none { it.value == mode }) "default" else mode

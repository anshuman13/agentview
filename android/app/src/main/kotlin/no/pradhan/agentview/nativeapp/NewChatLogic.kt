package no.pradhan.agentview.nativeapp

import kotlinx.serialization.builtins.ListSerializer

private val modelList = ListSerializer(ModelInfo.serializer())

fun parseModels(s: String?): List<ModelInfo> = s?.let { runCatching { protocolJson.decodeFromString(modelList, it) }.getOrNull() } ?: emptyList()

fun encodeModels(models: List<ModelInfo>): String = protocolJson.encodeToString(modelList, models)

// The model the sheet starts on: the last one used when the server still offers it, else the first on the list.
fun startModel(models: List<ModelInfo>, last: String?): String? =
    models.firstOrNull { it.value == last }?.value ?: models.firstOrNull()?.value

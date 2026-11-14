package no.pradhan.agentview.nativeapp.app

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import no.pradhan.agentview.nativeapp.net.protocolJson

data class MacOption(val name: String, val url: String, val running: Int, val current: Boolean)

// /api/connect on the Mac in use: that Mac first, then the other Macs on NetBird that run AgentView.
fun parseMacs(body: String, origin: String): List<MacOption> {
    val o = protocolJson.parseToJsonElement(body).jsonObject
    fun str(j: JsonObject, k: String) = j[k]?.jsonPrimitive?.contentOrNull.orEmpty()
    fun count(j: JsonObject) = j["running"]?.jsonPrimitive?.intOrNull ?: 0
    val here = MacOption(macLabel(str(o, "hostname")), origin, count(o), true)
    val others = (o["macs"] as? JsonArray).orEmpty().mapNotNull { e ->
        val m = e as? JsonObject ?: return@mapNotNull null
        val url = str(m, "url").ifEmpty { return@mapNotNull null }
        MacOption(macLabel(str(m, "name")), url, count(m), false)
    }
    return listOf(here) + others
}

private fun macLabel(name: String) = name.removeSuffix(".local").ifEmpty { "This Mac" }

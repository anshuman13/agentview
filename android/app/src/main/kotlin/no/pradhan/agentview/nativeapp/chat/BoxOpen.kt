package no.pradhan.agentview.nativeapp.chat

import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import no.pradhan.agentview.nativeapp.net.KeyValue
import no.pradhan.agentview.nativeapp.net.protocolJson

private const val KEY = "boxes"
private const val KEEP = 300
private val serializer = MapSerializer(String.serializer(), Int.serializer())

// Decoded once per store.
private var cache: Pair<KeyValue, LinkedHashMap<String, Int>>? = null
private fun boxes(kv: KeyValue) = cache?.takeIf { it.first === kv }?.second
    ?: LinkedHashMap(runCatching { protocolJson.decodeFromString(serializer, kv.get(KEY) ?: "{}") }.getOrDefault(emptyMap())).also { cache = kv to it }

// Web chat/transcript/boxOpen.ts: which transcript boxes are open, per box id, the 300 saved last.
fun readBox(kv: KeyValue, id: String, fallback: Boolean): Boolean = boxes(kv)[id]?.let { it == 1 } ?: fallback

fun saveBox(kv: KeyValue, id: String, open: Boolean) {
    val map = boxes(kv)
    map.remove(id)
    map[id] = if (open) 1 else 0
    while (map.size > KEEP) map.remove(map.keys.first())
    kv.put(KEY, protocolJson.encodeToString(serializer, map))
}

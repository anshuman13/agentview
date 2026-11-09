package no.pradhan.agentview.nativeapp.app

import java.net.URI
import java.net.URLDecoder
import no.pradhan.agentview.nativeapp.codex.split

data class DeepLink(val view: String? = null, val page: String? = null, val chat: String? = null, val session: String? = null, val action: String? = null)

val PAGE_IDS = listOf("observe", "deploy", "mcp", "settings")

fun parseDeepLink(uri: String?): DeepLink? {
    val query = uri?.let { runCatching { URI(it).rawQuery }.getOrNull() } ?: return null
    val params = query.split('&').filter { it.isNotEmpty() }.associate {
        val k = it.substringBefore('=')
        k to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
    }
    fun get(k: String) = params[k]?.takeIf { it.isNotEmpty() }
    val link = DeepLink(get("view"), get("page")?.takeIf { it in PAGE_IDS }, get("chat"), get("session"), get("action")?.takeIf { it == Shortcut.NEW_CHAT || it == Shortcut.ADD_TASK })
    return link.takeIf { it != DeepLink() }
}

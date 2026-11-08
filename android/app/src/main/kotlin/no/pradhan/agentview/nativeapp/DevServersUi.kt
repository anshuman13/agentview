package no.pradhan.agentview.nativeapp

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalUriHandler
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
data class DevPort(val port: Int, val name: String, val local: Boolean = false)

@Serializable
data class OpenedPort(val url: String? = null, val error: String? = null)

fun devPortMeta(p: DevPort) = p.name + if (p.local) " · localhost only, forwarded over NetBird" else ""

// Dev servers listening on the Mac; a tap opens one in the phone's browser.
@Composable
fun DevServersSheet(hub: Hub, onDismiss: () -> Unit) {
    var ports by remember { mutableStateOf<List<DevPort>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    LaunchedEffect(Unit) {
        ports = runCatching { protocolJson.decodeFromString<List<DevPort>>(hub.api.get("/api/ports")) }.getOrElse { error = it.message; emptyList() }
    }
    Sheet(onDismiss = onDismiss, title = "Dev servers", padded = false, full = false) {
        val list = ports
        when {
            list == null -> EmptyState("Looking for servers")
            list.isEmpty() -> EmptyState("No dev servers", error ?: "Start one on the Mac, such as npm run dev.")
            else -> list.forEach { p ->
                ListRow(":${p.port}", devPortMeta(p), trailing = { AvIcon("link-external", tint = av.fgMuted) }, onClick = {
                    scope.launch {
                        val r = runCatching { protocolJson.decodeFromString<OpenedPort>(hub.api.get("/api/ports/open?port=${p.port}")) }.getOrElse { OpenedPort(error = it.message) }
                        r.url?.let { uri.openUri(it) } ?: run { error = r.error }
                    }
                })
            }
        }
        error?.takeIf { !list.isNullOrEmpty() }?.let { EmptyState("Could not open", it) }
    }
}

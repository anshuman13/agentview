package no.pradhan.agentview.nativeapp.workspace

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.app.icon
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.command
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.write
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.color

@Serializable
data class DevPort(val port: Int, val name: String, val local: Boolean = false)

@Serializable
data class DevScript(val script: String, val command: String)

@Serializable
data class OpenedPort(val url: String? = null, val error: String? = null)

fun devPortMeta(p: DevPort) = p.name + if (p.local) " · localhost only, forwarded over NetBird" else ""

// Dev servers listening on the Mac; a tap opens one in the phone's browser.
@Composable
fun DevServersSheet(hub: Hub, onDismiss: () -> Unit) {
    var ports by remember { mutableStateOf<List<DevPort>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var script by remember { mutableStateOf<DevScript?>(null) }
    var started by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    suspend fun load() {
        ports = runCatching { protocolJson.decodeFromString<List<DevPort>>(hub.api.get("/api/ports")) }.getOrElse { error = it.message; emptyList() }
    }
    LaunchedEffect(Unit) {
        load()
        script = runCatching { protocolJson.decodeFromString<DevScript?>(hub.read("/api/devscript")) }.getOrNull()
    }
    Sheet(onDismiss = onDismiss, title = "Dev servers", padded = false, full = false) {
        val list = ports
        when {
            list == null -> EmptyState("Looking for servers…")
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
        script?.let { d ->
            Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                Text(if (started) "Running in the ${d.script} terminal" else d.command, Modifier.weight(1f), style = Type.footnote, color = av.fgMuted)
                Button("Start", {
                    hub.write("/api/terms?dev=1", "", "Could not start ${d.command}") { ok ->
                        if (ok) { started = true; scope.launch { delay(5000); load() } }
                    }
                }, variant = ButtonVariant.Tinted, icon = "play", enabled = !started && !hub.readOnly)
            }
        }
    }
}

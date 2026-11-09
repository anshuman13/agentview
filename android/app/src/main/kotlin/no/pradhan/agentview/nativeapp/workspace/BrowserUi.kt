package no.pradhan.agentview.nativeapp.workspace

import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.LiveSocket
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens

// Browser (web/src/workspace/BrowserPane.tsx): the streamed frames of the Mac's Chrome tab. It only watches; Back, Reload,
// picking a tab and connecting Chrome are writes and stay off in a read-only run.
@Composable
fun BrowserScreen(hub: Hub, onBack: () -> Unit) {
    val origin by hub.origin.collectAsState()
    var state by remember { mutableStateOf(ChromeMsg.State("connecting", "", false)) }
    var tabs by remember { mutableStateOf(ChromeMsg.Tabs(emptyList(), null)) }
    var frame by remember { mutableStateOf<ImageBitmap?>(null) }
    val socket = remember(origin) {
        val main = Handler(Looper.getMainLooper())
        LiveSocket(hub.client, "${wsOrigin(origin)}/ws?chrome", onText = { text ->
            when (val m = parseChrome(text)) {
                is ChromeMsg.State -> main.post { state = m; if (m.state != "on") frame = null }
                is ChromeMsg.Tabs -> main.post { tabs = m }
                is ChromeMsg.Frame -> runCatching { Base64.decode(m.data, Base64.DEFAULT).let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull()?.asImageBitmap()?.let { main.post { frame = it } }
                null -> Unit
            }
        }, onDrop = { state = ChromeMsg.State("off", "server", false); frame = null })
    }
    DisposableEffect(socket) { socket.open(); onDispose { socket.close() } }
    fun send(t: String, extra: Map<String, String> = emptyMap()) {
        if (hub.writes.allowed()) socket.send(buildJsonObject { put("t", t); extra.forEach { (k, v) -> put(k, v) } }.toString())
    }
    val tab = tabs.tabs.firstOrNull { it.id == tabs.current }

    Column(Modifier.fillMaxSize()) {
        PageHeader("Browser", onBack, subtitle = tab?.let { { androidx.compose.material3.Text(it.title.ifEmpty { it.url }, maxLines = 1) } }) {
            if (state.state == "on") MoreButton { close ->
                MenuItem("Back", "arrow-left", { close(); send("back") })
                MenuItem("Reload", "refresh", { close(); send("reload") })
            }
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                when (state.state) {
                    "connecting" -> item { EmptyState("Connecting to Chrome…", if (state.own) null else "Allow remote debugging if Chrome asks", small = false) }
                    "on" -> {
                        val f = frame
                        item {
                            if (f != null) Image(f, tab?.title, Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth)
                            else EmptyState(if (tabs.tabs.isNotEmpty()) "Waiting for the tab to draw" else "No tab open in Chrome", "Pick a tab below", small = false)
                        }
                        if (tabs.tabs.isNotEmpty()) {
                            item { SectionHeader("Tabs", tabs.tabs.size.toString()) }
                            item {
                                Group {
                                    tabs.tabs.forEachIndexed { i, t ->
                                        if (i > 0) Hairline()
                                        ListRow(t.title.ifEmpty { t.url }, t.url, lines = 1, selected = t.id == tabs.current, onClick = { send("tab", mapOf("id" to t.id)) })
                                    }
                                }
                            }
                        }
                    }
                    else -> item {
                        EmptyState("Show your Chrome here", if (state.own && state.reason == "nochrome") "Chrome is not running" else CHROME_REASONS[state.reason] ?: state.reason, small = false, action = if (state.reason != "server") ({
                            Button(if (state.reason == "nofda") "Open Full Disk Access settings" else "Connect Chrome", { send("setup") }, variant = ButtonVariant.Filled, size = ButtonSize.Sm)
                        }) else null)
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}

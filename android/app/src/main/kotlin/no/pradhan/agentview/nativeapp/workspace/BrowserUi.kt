package no.pradhan.agentview.nativeapp.workspace

import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject
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
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.LiveSocket
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens

// Browser (web/src/workspace/BrowserPane.tsx): the streamed frames of the Mac's Chrome tab. A tap clicks the page, a drag
// scrolls it, and a tap in a text field opens the keyboard. Mark up draws on the frame and adds it to the prompt. Input,
// Back, Reload, picking a tab and connecting Chrome are writes and stay off in a read-only run.
@Composable
fun BrowserScreen(hub: Hub, onBack: () -> Unit) {
    val origin by hub.origin.collectAsState()
    var state by remember { mutableStateOf(ChromeMsg.State("connecting", "", false)) }
    var tabs by remember { mutableStateOf(ChromeMsg.Tabs(emptyList(), null)) }
    var frame by remember { mutableStateOf<ImageBitmap?>(null) }
    var page by remember { mutableStateOf(IntSize.Zero) }
    var editable by remember { mutableStateOf(false) }
    val socket = remember(origin) {
        val main = Handler(Looper.getMainLooper())
        LiveSocket(hub.client, "${wsOrigin(origin)}/ws?chrome", onText = { text ->
            when (val m = parseChrome(text)) {
                is ChromeMsg.State -> main.post { state = m; if (m.state != "on") frame = null }
                is ChromeMsg.Tabs -> main.post { tabs = m }
                is ChromeMsg.Frame -> runCatching { Base64.decode(m.data, Base64.DEFAULT).let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull()?.asImageBitmap()?.let { main.post { frame = it; page = IntSize(m.w, m.h) } }
                is ChromeMsg.Editable -> main.post { editable = m.on }
                is ChromeMsg.Picked -> main.post { hub.elements.value = hub.elements.value + m.el; hub.notice.value = "Added ${elementChip(m.el)} to the prompt" }
                null -> Unit
            }
        }, onDrop = { state = ChromeMsg.State("off", "server", false); frame = null })
    }
    DisposableEffect(socket) { socket.open(); onDispose { socket.close() } }
    fun send(t: String, extra: Map<String, String> = emptyMap()) {
        if (hub.writes.allowed()) socket.send(buildJsonObject { put("t", t); extra.forEach { (k, v) -> put(k, v) } }.toString())
    }
    fun sendJson(o: JsonObject) {
        if (hub.writes.allowed()) socket.send(o.toString())
    }
    val tab = tabs.tabs.firstOrNull { it.id == tabs.current }
    // Pick mode (web BrowserPane): Chrome outlines the element under a tap, which adds it to the prompt as a chip.
    var picking by remember { mutableStateOf(false) }
    var marking by remember { mutableStateOf(false) }
    val markup = remember { MarkupState() }
    val pickOn = picking && state.state == "on"
    DisposableEffect(pickOn, tabs.current) {
        if (pickOn) sendJson(buildJsonObject { put("t", "pick"); put("on", true) })
        onDispose { if (pickOn) sendJson(buildJsonObject { put("t", "pick"); put("on", false) }) }
    }
    val kbdFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var kbd by remember { mutableStateOf(TextFieldValue(KBD_SEED, TextRange(KBD_SEED.length))) }
    // The page reports after each tap whether it landed in a text field; the keyboard stays open only then.
    LaunchedEffect(editable) { if (editable) runCatching { kbdFocus.requestFocus(); keyboard?.show() } else keyboard?.hide() }
    fun closeTab(id: String) = send("close", mapOf("id" to id))

    Column(Modifier.fillMaxSize()) {
        PageHeader("Browser", onBack, subtitle = tab?.let { { androidx.compose.material3.Text(it.title.ifEmpty { it.url }, maxLines = 1) } }) {
            if (state.state == "on" && !hub.readOnly) IconBtn("inspect", if (picking) "Stop picking" else "Pick an element", { picking = !picking; marking = false }, on = picking)
            if (state.state == "on" && !hub.readOnly) IconBtn("edit", if (marking) "Close markup" else "Mark up", { marking = !marking; picking = false }, on = marking)
            if (state.state == "on") MoreButton { close ->
                MenuItem("Back", "arrow-left", { close(); send("back") })
                MenuItem("Reload", "refresh", { close(); send("reload") })
            }
        }
        Box(Modifier.weight(1f)) { PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                when (state.state) {
                    "connecting" -> item { EmptyState("Connecting to Chrome…", if (state.own) null else "Allow remote debugging if Chrome asks", icon = "globe", small = false) }
                    "on" -> {
                        val f = frame
                        item {
                            if (f != null) Box {
                                Image(f, tab?.title, Modifier.fillMaxWidth().pointerInput(page, pickOn) {
                                    // A tap clicks the page and a drag scrolls it, in the page's own coordinates.
                                    fun touch(type: String, p: Offset) = sendJson(buildJsonObject {
                                        put("t", "touch"); put("type", type)
                                        put("x", p.x / size.width * page.width); put("y", p.y / size.height * page.height)
                                    })
                                    awaitEachGesture {
                                        val down = awaitFirstDown()
                                        down.consume()
                                        if (pickOn) {
                                            sendJson(buildJsonObject { put("t", "pickAt"); put("x", down.position.x / size.width * page.width); put("y", down.position.y / size.height * page.height) })
                                            return@awaitEachGesture
                                        }
                                        touch("touchStart", down.position)
                                        while (true) {
                                            val c = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                                            c.consume()
                                            if (!c.pressed) { touch("touchEnd", c.position); break }
                                            touch("touchMove", c.position)
                                        }
                                    }
                                }, contentScale = ContentScale.FillWidth)
                                if (marking) MarkupLayer(markup, f)
                                BasicTextField(kbd, { v ->
                                    kbdInput(kbd.text, v.text).forEach { (t, value) -> sendJson(buildJsonObject { put("t", t); put(if (t == "key") "key" else "text", value); if (value == "Enter") put("keyCode", 13) else if (value == "Backspace") put("keyCode", 8) }) }
                                    kbd = if (v.text.isEmpty() || '\n' in v.text || v.text.length > 200) TextFieldValue(KBD_SEED, TextRange(KBD_SEED.length)) else v
                                }, Modifier.size(1.dp).alpha(0f).focusRequester(kbdFocus), keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password))
                            }
                            else EmptyState(if (tabs.tabs.isNotEmpty()) "Waiting for the tab to draw" else "No tab open in Chrome", "Pick a tab below", icon = "globe", small = false)
                        }
                        if (tabs.tabs.isNotEmpty()) {
                            item { SectionHeader("Tabs", tabs.tabs.size.toString()) }
                            item {
                                Group {
                                    tabs.tabs.forEachIndexed { i, t ->
                                        if (i > 0) Hairline()
                                        ListRow(t.title.ifEmpty { t.url }, t.url, selected = t.id == tabs.current, onClick = { send("tab", mapOf("id" to t.id)) }, trailing = { IconBtn("close", "Close tab", { closeTab(t.id) }) })
                                    }
                                }
                            }
                        }
                    }
                    else -> item {
                        EmptyState("Show your Chrome here", if (state.own && state.reason == "nochrome") "Chrome is not running" else CHROME_REASONS[state.reason] ?: state.reason, icon = "globe", small = false, action = if (state.reason != "server") ({
                            Button(if (state.reason == "nofda") "Open Full Disk Access settings" else "Connect Chrome", { send("setup") }, variant = ButtonVariant.Filled, size = ButtonSize.Sm)
                        }) else null)
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        } }
        if (marking && state.state == "on") MarkupBar(hub, markup, frame) { marking = false }
    }
}

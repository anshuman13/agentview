package no.pradhan.agentview.nativeapp.workspace

import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.LiveSocket
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.newTerminal
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.terminals
import no.pradhan.agentview.nativeapp.net.write
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select

// Terminal (web/src/workspace/Terminal.tsx): the chat's shells as a read view of their output, with a line input and the phone keys.
@Composable
fun TerminalScreen(hub: Hub, onBack: () -> Unit) {
    val shownId by hub.store.state.select { it.shownId }
    val chat = shownId
    val (load, reload) = rememberLoad(chat) { hub.terminals() }
    val tabs = load.data ?: emptyList()
    var active by rememberSaveable(chat) { mutableStateOf("") }
    val id = tabs.firstOrNull { it.id == active }?.id ?: tabs.lastOrNull()?.id

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Terminal", onBack) { IconBtn("refresh", "Refresh", reload) }
        if (tabs.size > 1) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            tabs.forEach { t -> Chip(t.name.ifEmpty { "Terminal" }, { active = t.id }, on = t.id == id) }
        }
        when {
            load.data == null && load.error.isNotEmpty() -> ErrorHint(load.error)
            load.data == null -> Hint("Loading…")
            id == null -> EmptyState("No terminal open", "A terminal runs a shell in the chat's folder", small = false, action = {
                Button("New terminal", { hub.newTerminal("Terminal unavailable") { if (it) reload() } }, variant = ButtonVariant.Filled)
            })
            else -> TermView(hub, id, onGone = reload)
        }
    }
}

@Composable
private fun TermView(hub: Hub, id: String, onGone: () -> Unit) {
    val screen = remember(id) { TermScreen() }
    var version by remember(id) { mutableIntStateOf(0) }
    val origin by hub.origin.collectAsState()
    val list = rememberLazyListState()
    val follow = remember(id) { booleanArrayOf(true) }
    val socket = remember(id, origin) {
        val main = Handler(Looper.getMainLooper())
        // Output batches are written as they come, and the lines are rebuilt at most once a frame.
        var queued = false
        val redraw = Choreographer.FrameCallback { queued = false; version++ }
        LiveSocket(hub.client, "${wsOrigin(origin)}/ws?term=${enc(id)}",
            onText = { t -> main.post { follow[0] = !list.canScrollForward; screen.write(t); if (!queued) { queued = true; Choreographer.getInstance().postFrameCallback(redraw) } } },
            onOpen = { screen.reset(); version++ },
            onGone = onGone,
        )
    }
    DisposableEffect(socket) { socket.open(); onDispose { socket.close() } }
    val lines = remember(version) { screen.lines() }
    LaunchedEffect(lines.size, version) { if (follow[0] && lines.isNotEmpty()) list.scrollToItem(lines.lastIndex) }
    var input by rememberSaveable(id) { mutableStateOf("") }
    val scroll = rememberScrollState()
    fun send(data: String) { if (hub.writes.allowed()) socket.send(termInput(data)) }

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth().background(av.surface)) {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = Tokens.sp4), state = list) {
                itemsIndexed(lines, key = { i, _ -> i }, contentType = { _, _ -> "line" }) { _, l -> Text(termText(l), Modifier.horizontalScroll(scroll), style = TermMono, color = av.fg, softWrap = false) }
            }
        }
        HorizontalDivider(color = av.border, thickness = Tokens.hairline)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            TERM_KEYS.forEach { (label, seq) -> Chip(label, { send(seq) }) }
        }
        Row(Modifier.fillMaxWidth().padding(start = Tokens.listPad, end = Tokens.sp2, bottom = Tokens.sp4)) {
            TextField(
                input, { input = it }, Modifier.weight(1f), placeholder = "Type a command", singleLine = true, style = TermMono,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send, autoCorrectEnabled = false),
                keyboardActions = KeyboardActions(onSend = { send(input + "\r"); input = "" }),
            )
            IconBtn("send", "Send", { send(input + "\r"); input = "" })
        }
    }
}

@Composable
private fun termColor(c: Int): Color {
    val p = av
    return when (c) {
        0 -> p.fgFaint; 1, 9 -> p.hueRed; 2, 10 -> p.hueGreen; 3, 11 -> p.hueYellow; 4, 12 -> p.hueBlue
        5, 13 -> p.hueMagenta; 6, 14 -> p.hueSky; 8 -> p.fgFaint; 15 -> p.fgStrong; else -> p.fg
    }
}

@Composable
private fun termText(l: TermLine): AnnotatedString {
    if (l.runs.isEmpty()) return AnnotatedString(l.text)
    val colors = (0..15).map { termColor(it) }
    return buildAnnotatedString {
        append(l.text)
        for (r in l.runs) if (r.end <= l.text.length) addStyle(SpanStyle(color = colors[r.color]), r.start, r.end)
    }
}

private val TermMono = Mono.copy(fontSize = Tokens.fsSm, lineHeight = Tokens.lineSm)

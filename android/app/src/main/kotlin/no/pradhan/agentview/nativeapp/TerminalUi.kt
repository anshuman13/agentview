package no.pradhan.agentview.nativeapp

import android.os.Handler
import android.os.Looper
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Refresh
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

// Terminal (web/src/workspace/Terminal.tsx): the chat's shells as a read view of their output, with a line input and the phone keys.
@Composable
fun TerminalScreen(hub: Hub, onBack: () -> Unit) {
    val st by hub.store.state.collectAsState()
    val chat = st.shownId
    val (load, reload) = rememberLoad(chat) { parseTerms(hub.read("/api/terms")) }
    val tabs = load.data ?: emptyList()
    var active by rememberSaveable(chat) { mutableStateOf("") }
    val id = tabs.firstOrNull { it.id == active }?.id ?: tabs.lastOrNull()?.id

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Terminal", onBack) { IconBtn(Icons.Filled.Refresh, "Refresh", reload) }
        if (tabs.size > 1) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.sp6, vertical = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
            tabs.forEach { t -> Chip(t.name.ifEmpty { "Terminal" }, { active = t.id }, on = t.id == id) }
        }
        when {
            load.data == null && load.error.isNotEmpty() -> ErrorHint(load.error)
            load.data == null -> Hint("Loading")
            id == null -> EmptyState("No terminal open", "A terminal runs a shell in the chat's folder", small = false, action = {
                Button("New terminal", { hub.write("/api/terms", "", "Terminal unavailable") { if (it) reload() } }, variant = ButtonVariant.Filled)
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
        LiveSocket(hub.client, "${wsOrigin(origin)}/ws?term=${enc(id)}",
            onText = { t -> main.post { follow[0] = !list.canScrollForward; screen.write(t); version++ } },
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
                items(lines) { l -> Text(termText(l), Modifier.horizontalScroll(scroll), style = Mono, color = av.fg, softWrap = false) }
            }
        }
        HorizontalDivider(color = av.border, thickness = Tokens.hairline)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.sp6, vertical = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
            TERM_KEYS.forEach { (label, seq) -> Chip(label, { send(seq) }) }
        }
        Row(Modifier.fillMaxWidth().padding(start = Tokens.sp6, end = Tokens.sp2, bottom = Tokens.sp4)) {
            TextField(
                input, { input = it }, Modifier.weight(1f), placeholder = "Type a command", singleLine = true, style = Mono,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send, autoCorrectEnabled = false),
                keyboardActions = KeyboardActions(onSend = { send(input + "\r"); input = "" }),
            )
            IconBtn(Icons.AutoMirrored.Filled.Send, "Send", { send(input + "\r"); input = "" })
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

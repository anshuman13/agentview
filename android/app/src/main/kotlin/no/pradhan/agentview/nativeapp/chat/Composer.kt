package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import android.speech.SpeechRecognizer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import no.pradhan.agentview.nativeapp.app.BarEvent
import no.pradhan.agentview.nativeapp.app.BarState
import no.pradhan.agentview.nativeapp.app.barHidden
import no.pradhan.agentview.nativeapp.app.barState
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.app.chatFiles
import no.pradhan.agentview.nativeapp.app.interrupt
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.sessions.chatPlace
import no.pradhan.agentview.nativeapp.app.refreshWorkspace
import no.pradhan.agentview.nativeapp.app.submit
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Tokens
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.WhileStarted
import no.pradhan.agentview.nativeapp.ui.WordClamp
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Composer(hub: Hub, chatId: String, sessionId: String?, session: SessionInfo?, running: Boolean, waiting: Boolean) {
    val s = remember(chatId) { ComposerState(hub, chatId) }
    LaunchedEffect(chatId, sessionId) { if (sessionId != null) hub.setDraft(chatId, s.full) }
    val dictation = remember(chatId) { Dictation() }
    var sheet by remember { mutableStateOf<Picker?>(null) }
    var uploading by remember { mutableIntStateOf(0) }
    var multiline by remember(chatId) { mutableStateOf(false) }
    val trigger = commandTrigger(s.text.text, s.text.selection.end)
    val suggestions = rememberSuggestions(s, trigger, session)
    val prompts by hub.savedPrompts.items.collectAsState()
    val lastPrompt by hub.store.state.select { st -> st.events.lastOrNull { it.kind == "user" }?.id }
    val history = remember(chatId, lastPrompt, prompts) { buildHistory(hub.store.state.value.events, prompts) }
    val ghost = if (suggestions.isEmpty() && !s.text.text.startsWith("!") && s.text.selection.end == s.text.text.length) ghostFor(s.text.text, history) else ""
    val attach = rememberAttach(hub, { uploading += it }) { mark -> s.replaceMarks(s.marks + mark) }
    var bar by remember(chatId) { mutableStateOf(barState(BarState(), if (s.full.isEmpty()) BarEvent.TextEmpty else BarEvent.TextFilled)) }
    val imeVisible = WindowInsets.isImeVisible
    LaunchedEffect(chatId) { hub.draftChanged.collect { if (it == chatId) s.reload() } }
    LaunchedEffect(chatId) { hub.pendingUse.collect { u -> if (u != null) { s.uses = addUse(s.uses, u); hub.pendingUse.value = null } } }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val window = LocalWindowInfo.current
    // Use again and Saved prompts tap in a sheet or menu window; focus waits until this window has it back.
    LaunchedEffect(chatId) {
        hub.composerFocus.collect {
            if (it != chatId) return@collect
            s.reload()
            snapshotFlow { window.isWindowFocused }.first { f -> f }
            runCatching { focus.requestFocus(); keyboard?.show() }
        }
    }
    LaunchedEffect(imeVisible) { bar = barState(bar, if (imeVisible) BarEvent.KeyboardUp else BarEvent.KeyboardDown) }
    LaunchedEffect(s.full.isEmpty()) { bar = barState(bar, if (s.full.isEmpty()) BarEvent.TextEmpty else BarEvent.TextFilled) }
    LaunchedEffect(bar) { hub.shell.composing.value = barHidden(bar) }
    DisposableEffect(chatId) { onDispose { hub.shell.composing.value = false } }
    val c = av
    val canTalk = SpeechRecognizer.isRecognitionAvailable(LocalContext.current)
    val shape = RoundedCornerShape(if (multiline || s.marks.isNotEmpty()) Tokens.shapeLg else Tokens.radiusPill)
    Column(Modifier.fillMaxWidth().background(c.bg).padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp4, bottom = Tokens.sp2), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        if (suggestions.isNotEmpty()) SuggestionList(suggestions) { sg ->
            val r = acceptSuggestion(s.text.text, trigger!!.start, s.text.selection.end, sg.insert)
            s.set(TextFieldValue(r.first, TextRange(r.second)))
        } else if (ghost.isNotEmpty()) GhostRow(s.text.text, ghost) { val next = s.text.text + ghost; s.set(TextFieldValue(next, TextRange(next.length))) }
        StaleNote(hub)
        val asked by hub.store.state.select { st -> quickReplies(st.events) }
        if (asked.isNotEmpty() && !running && !waiting && s.full.isEmpty()) FlowRow(Modifier.padding(horizontal = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
            asked.forEach { t -> Chip(t, { s.set(TextFieldValue(t, TextRange(t.length))); s.submit(false, uploading) }, icon = if (t in QUICK_REPLIES) null else "reply") }
        }
        Column(Modifier.fillMaxWidth().clip(shape).background(c.raised).border(BorderStroke(Tokens.hairline, c.border), shape)) {
            if (s.uses.isNotEmpty()) FlowRow(Modifier.padding(start = Tokens.sp4, end = Tokens.sp4, top = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
                s.uses.forEach { u -> Chip(useLabel(u), { s.uses = s.uses - u }, icon = "plug", trailingIcon = "close", trailingLabel = "Remove") }
            }
            if (s.marks.isNotEmpty()) FlowRow(Modifier.padding(start = Tokens.sp4, end = Tokens.sp4, top = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
                s.marks.forEachIndexed { i, m -> Chip(markLabel(m), { s.replaceMarks(s.marks.filterIndexed { j, _ -> j != i }) }, icon = if (m.startsWith("[Image")) "file-media" else "file", trailingIcon = "close", trailingLabel = "Remove") }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                if (uploading > 0) Box(Modifier.size(Tokens.touch).semantics { contentDescription = "Uploading" }, contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(Tokens.iconMd), color = c.accent, strokeWidth = Tokens.sp1) }
                else IconBtn("add", "Add", { sheet = Picker.Add })
                KeyboardImages(attach.image) { ComposerInput(
                    s, composerPlaceholder(providerLabel(session?.provider), placeholderState(waiting, session?.compacting == true, running, s.uses.isNotEmpty()), canTalk),
                    Modifier.weight(1f).focusRequester(focus).onFocusChanged { bar = barState(bar, if (it.isFocused) BarEvent.Focus else BarEvent.Blur) }, { multiline = it },
                ) }
                ComposerActions(hub, s, running, uploading, dictation, canTalk)
            }
        }
    }
    ComposerSheets(hub, s, uploading, session, sheet, attach) { sheet = it }
}

// "No update for Ns" once the event stream has been quiet for 30 s; its own composable so the 5 s tick recomposes only it.
@Composable
private fun StaleNote(hub: Hub) {
    val stale = staleSeconds(hub)
    if (stale >= 30) Text("No update for ${stale}s", Modifier.padding(horizontal = Tokens.sp6), style = Type.footnote, color = av.fgMuted)
}

// Seconds since the event stream last sent anything, checked every 5 s while the app is visible; 0 in the background.
@Composable
private fun staleSeconds(hub: Hub): Int {
    var stale by remember { mutableIntStateOf(0) }
    WhileStarted {
        try {
            while (true) {
                delay(5_000)
                val seen = hub.stream.lastSeen
                stale = if (seen > 0) ((System.currentTimeMillis() - seen) / 1000).toInt() else 0
            }
        } finally { stale = 0 }
    }
    return stale
}

@Composable
private fun GhostRow(typed: String, ghost: String, onPick: () -> Unit) {
    val c = av
    val tail = (if (typed.length > 12) "…" else "") + typed.takeLast(12)
    Row(
        Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clickable(onClickLabel = "Use this suggestion", onClick = onPick).padding(horizontal = Tokens.sp6),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp3),
    ) {
        AvIcon("arrow-right", null, Tokens.iconMd, tint = c.fgMuted)
        Text(buildAnnotatedString {
            withStyle(SpanStyle(color = c.fgMuted)) { append(tail) }
            withStyle(SpanStyle(color = c.fg, fontWeight = FontWeight.Bold)) { append(ghost) }
        }, style = Type.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun rememberSuggestions(s: ComposerState, trigger: Trigger?, session: SessionInfo?): List<Suggestion> {
    val key = trigger?.let { "${it.start}:${it.query}" } ?: ""
    LaunchedEffect(s.chatId, trigger?.file) {
        if (trigger?.file == true && s.files == null) s.files = runCatching { s.hub.chatFiles(s.chatId) }.getOrDefault(emptyList())
    }
    val chatQ = chatQuery(trigger)
    LaunchedEffect(chatQ != null) { if (chatQ != null) s.hub.refreshWorkspace() }
    val ws by s.hub.workspace.collectAsState()
    val files = s.files
    val ranked = remember(files, trigger?.query, trigger?.file) { if (trigger?.file == true && chatQ == null) rankFiles(files.orEmpty(), trigger.query) else emptyList() }
    return when {
        trigger == null || key == s.dismissed -> emptyList()
        chatQ != null -> rankChats(ws.saved.filter { it.sessionId != session?.sessionId }, chatQ).map { Suggestion(it.title, chatPlace(ws, it.cwd), "@chat:${it.sessionId}") }
        trigger.file -> ranked.map { f -> Suggestion(f.substringAfterLast('/'), f.substringBeforeLast('/', ""), "@$f") }
        else -> rankCommands(session?.commands ?: emptyList(), trigger.query).map { Suggestion("/${it.name}", it.description, "/${it.name}") }
    }
}

@Composable
private fun SuggestionList(suggestions: List<Suggestion>, onPick: (Suggestion) -> Unit) {
    val c = av
    val shape = RoundedCornerShape(Tokens.shapeLg)
    Column(
        Modifier.fillMaxWidth().heightIn(max = Tokens.imageMax).clip(shape).background(c.raised).border(BorderStroke(Tokens.hairline, c.border), shape)
            .verticalScroll(rememberScrollState()).padding(Tokens.sp2),
    ) {
        for (s in suggestions) Column(
            Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clip(RoundedCornerShape(Tokens.radius)).clickable { onPick(s) }.padding(horizontal = Tokens.sp6, vertical = Tokens.sp3),
        ) {
            Text(s.label, style = Type.body.copy(fontFamily = FontFamily.Monospace), color = c.fg)
            if (s.detail.isNotEmpty()) Text(s.detail, style = Type.footnote, color = c.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun ComposerInput(s: ComposerState, placeholder: String, modifier: Modifier, onMultiline: (Boolean) -> Unit) {
    val c = av
    BasicTextField(
        value = s.text,
        onValueChange = { s.set(it) },
        modifier = modifier.padding(vertical = Tokens.sp2),
        textStyle = Type.body.copy(color = c.fg),
        cursorBrush = SolidColor(c.accent),
        maxLines = 6,
        onTextLayout = { onMultiline(it.lineCount > 1) },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        decorationBox = { inner ->
            Box(Modifier.heightIn(min = Tokens.touch - Tokens.sp4), contentAlignment = Alignment.CenterStart) {
                if (s.text.text.isEmpty()) WordClamp(androidx.compose.ui.text.AnnotatedString(placeholder), Type.body, c.fgMuted, 1)
                inner()
            }
        },
    )
}

@Composable
private fun ComposerActions(hub: Hub, s: ComposerState, running: Boolean, uploading: Int, dictation: Dictation, canTalk: Boolean) {
    val c = av
    val text = s.text
    val typed = s.full.isNotBlank()
    var talking by remember { mutableStateOf(false) }
    var dictating by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    val fill = { spoken: String, final: Boolean -> dictation.apply(text.text, text.selection.end, spoken, final)?.let { (t, caret) -> s.set(TextFieldValue(t, TextRange(caret))) }; Unit }
    if (!typed || dictating) VoiceButton(fill, { hub.notice.value = it }, onListening = { dictating = it })
    val canSend = typed && uploading == 0
    when {
        talking || (canTalk && !typed && !running) -> VoiceButton(fill, { hub.notice.value = it }, onSubmit = { s.submit(false, uploading, voice = true) }, onListening = { talking = it })
        running && !typed -> SendCircle("Stop", !hub.readOnly, hub::interrupt) { Box(Modifier.size(Tokens.sp6).background(c.bg, RoundedCornerShape(Tokens.radiusXs))) }
        else -> SendCircle(if (running) "Queue" else "Send", canSend, { haptic.performHapticFeedback(HapticFeedbackType.Confirm); s.submit(false, uploading) }, if (running) ({ haptic.performHapticFeedback(HapticFeedbackType.LongPress); s.submit(true, uploading) }) else null) { AvIcon("send", null, Tokens.iconLg, tint = if (canSend) c.bg else c.fgFaint) }
    }
}

@Composable
private fun SendCircle(label: String, enabled: Boolean, onClick: () -> Unit, onLongClick: (() -> Unit)? = null, glyph: @Composable () -> Unit) {
    Box(Modifier.size(Tokens.touch).semantics { contentDescription = label }.combinedClickable(enabled = enabled, onClickLabel = label, onLongClickLabel = onLongClick?.let { "Stop and send" }, onLongClick = onLongClick, onClick = onClick), contentAlignment = Alignment.Center) {
        RoundFace(enabled, glyph)
    }
}

@Composable
internal fun RoundFace(enabled: Boolean = true, glyph: @Composable () -> Unit) {
    Box(Modifier.size(Tokens.sp20).clip(CircleShape).background(if (enabled) av.fg else av.hover), contentAlignment = Alignment.Center) { glyph() }
}

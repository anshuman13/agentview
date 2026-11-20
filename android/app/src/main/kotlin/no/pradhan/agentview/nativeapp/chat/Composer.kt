package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
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
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalSheet
import no.pradhan.agentview.nativeapp.codex.autopilot.endedRun
import no.pradhan.agentview.nativeapp.codex.autopilot.finishedLine
import no.pradhan.agentview.nativeapp.codex.autopilot.runDetail
import no.pradhan.agentview.nativeapp.codex.autopilot.runLine
import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.app.chatFiles
import no.pradhan.agentview.nativeapp.app.interrupt
import no.pradhan.agentview.nativeapp.net.menuModes
import no.pradhan.agentview.nativeapp.net.modeSteps
import no.pradhan.agentview.nativeapp.net.newestModels
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.sessions.chatPlace
import no.pradhan.agentview.nativeapp.sessions.since
import no.pradhan.agentview.nativeapp.app.refreshUsage
import no.pradhan.agentview.nativeapp.app.refreshWorkspace
import no.pradhan.agentview.nativeapp.app.runInTerminal
import no.pradhan.agentview.nativeapp.app.setAccount
import no.pradhan.agentview.nativeapp.app.setEffort
import no.pradhan.agentview.nativeapp.app.setMode
import no.pradhan.agentview.nativeapp.app.setModel
import no.pradhan.agentview.nativeapp.app.setReview
import no.pradhan.agentview.nativeapp.app.setBuildFlow
import no.pradhan.agentview.nativeapp.app.submit
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ChoiceRow
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TimeDialog
import no.pradhan.agentview.nativeapp.ui.Tokens
import java.time.ZonedDateTime
import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.app.sendAt
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.WordClamp
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.plural
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.well

private class Choice(val value: String, val label: String, val detail: String = "")

private val BUILD_CHOICES = listOf(Choice("off", "Off", "Prompts run as usual")) +
    Choice("flow", "Spec flow", "Spec, sketch and your approval before building")

private enum class Picker { Add, Settings, Effort, Account, Build, SendAt, Mcp, McpTools }

private class ComposerState(val hub: Hub, val chatId: String) {
    private val draft = splitMarks(hub.draft(chatId))
    var text by mutableStateOf(TextFieldValue(draft.body, TextRange(draft.body.length)))
    var marks by mutableStateOf(draft.marks)
    var uses by mutableStateOf<List<Use>>(emptyList())
    var useServer by mutableStateOf<String?>(null)

    fun reload() {
        val back = splitMarks(hub.draft(chatId))
        marks = back.marks
        text = TextFieldValue(back.body, TextRange(back.body.length))
    }

    var dismissed by mutableStateOf("")
    var files by mutableStateOf<List<String>?>(null)
    val full get() = joinMarks(text.text, marks)

    fun set(v: TextFieldValue) {
        val changed = v.text != text.text
        text = v
        if (changed) hub.setDraft(chatId, full)
    }

    fun replaceMarks(next: List<String>) {
        marks = next
        hub.setDraft(chatId, full)
    }

    private fun clear() {
        marks = emptyList()
        text = TextFieldValue("")
        hub.setDraft(chatId, "")
    }

    private fun restore(sent: String, picked: List<Use>) {
        val back = splitMarks(restoreUnsent(full, sent))
        marks = back.marks
        text = TextFieldValue(back.body, TextRange(back.body.length))
        uses = picked
        hub.setDraft(chatId, full)
    }

    // The text with the picked uses appended; the chips clear once a send has used them.
    private fun takeUses(t: String): Pair<String, List<Use>> {
        val picked = uses
        val sent = withUses(t, picked)
        if (sent != t) uses = emptyList()
        return sent to picked
    }

    fun build(uploading: Int) {
        when (val step = buildStep(full, uploading, hub.readOnly)) {
            is BuildStep.Notice -> hub.notice.value = step.text
            is BuildStep.Send -> {
                val (sent, picked) = takeUses(step.brief)
                clear()
                hub.submit(buildPrompt(sent), false, buildPrompt(step.brief)) { restore(step.brief, picked) }
            }
        }
    }

    fun sendAt(time: String, uploading: Int) {
        val t = full
        if (t.isBlank()) return
        if (uploading > 0) { hub.notice.value = "Wait for the upload to finish"; return }
        val (sent, picked) = takeUses(t)
        clear()
        hub.sendAt(time, sent) { restore(t, picked) }
    }

    fun submit(steer: Boolean, uploading: Int) {
        val t = full
        if (t.isBlank() || uploading > 0) return
        shellCommand(t)?.let { if (hub.runInTerminal(it)) clear(); return }
        val (sent, picked) = takeUses(t)
        clear()
        hub.submit(sent, steer, t) { restore(t, picked) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Composer(hub: Hub, chatId: String, sessionId: String?, session: SessionInfo?, running: Boolean, waiting: Boolean, run: ChatRun?) {
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
    LaunchedEffect(imeVisible) { bar = barState(bar, if (imeVisible) BarEvent.KeyboardUp else BarEvent.KeyboardDown) }
    LaunchedEffect(s.full.isEmpty()) { bar = barState(bar, if (s.full.isEmpty()) BarEvent.TextEmpty else BarEvent.TextFilled) }
    LaunchedEffect(bar) { hub.shell.composing.value = barHidden(bar) }
    DisposableEffect(chatId) { onDispose { hub.shell.composing.value = false } }
    val c = av
    val shape = RoundedCornerShape(if (multiline || s.marks.isNotEmpty()) Tokens.radius else Tokens.radiusPill)
    Column(Modifier.fillMaxWidth().background(c.bg).padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp4, bottom = Tokens.sp2), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        if (suggestions.isNotEmpty()) SuggestionList(suggestions) { sg ->
            val r = acceptSuggestion(s.text.text, trigger!!.start, s.text.selection.end, sg.insert)
            s.set(TextFieldValue(r.first, TextRange(r.second)))
        } else if (ghost.isNotEmpty()) GhostRow(s.text.text, ghost) { val next = s.text.text + ghost; s.set(TextFieldValue(next, TextRange(next.length))) }
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
                ComposerInput(
                    s, composerPlaceholder(providerLabel(session?.provider), placeholderState(waiting, session?.compacting == true, running, s.uses.isNotEmpty())),
                    Modifier.weight(1f).onFocusChanged { bar = barState(bar, if (it.isFocused) BarEvent.Focus else BarEvent.Blur) }, { multiline = it },
                )
                ComposerActions(hub, s, running, uploading, dictation)
            }
        }
    }
    ComposerSheets(hub, s, uploading, session, run, sheet, attach) { sheet = it }
}

private fun placeholderState(waiting: Boolean, compacting: Boolean, running: Boolean, hasUses: Boolean) = when {
    waiting -> "waiting"
    compacting -> "compacting"
    running -> "running"
    hasUses -> "uses"
    else -> "idle"
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
    Column(Modifier.fillMaxWidth().heightIn(max = Tokens.imageMax).well(c).verticalScroll(rememberScrollState())) {
        for (s in suggestions) Column(
            Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clickable { onPick(s) }.padding(horizontal = Tokens.sp6, vertical = Tokens.sp3),
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
private fun ComposerActions(hub: Hub, s: ComposerState, running: Boolean, uploading: Int, dictation: Dictation) {
    val c = av
    val text = s.text
    val typed = s.full.isNotBlank()
    var dictating by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    if (!typed || dictating) VoiceButton({ spoken, final -> dictating = !final; dictation.apply(text.text, text.selection.end, spoken, final)?.let { (t, caret) -> s.set(TextFieldValue(t, TextRange(caret))) } }, { hub.notice.value = it })
    if (running && typed) Button("Stop and send", { s.submit(true, uploading) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    val canSend = typed && uploading == 0
    if (running && !typed) SendCircle("Stop", !hub.readOnly, hub::interrupt) { Box(Modifier.size(Tokens.sp6).background(c.sunken, RoundedCornerShape(Tokens.radiusXs))) }
    else if (typed && !dictating) SendCircle(if (running) "Queue" else "Send", canSend, { haptic.performHapticFeedback(HapticFeedbackType.Confirm); s.submit(false, uploading) }) { AvIcon("send", null, Tokens.iconLg, tint = if (canSend) c.sunken else c.fgFaint) }
}

@Composable
private fun ComposerSheets(hub: Hub, s: ComposerState, uploading: Int, session: SessionInfo?, run: ChatRun?, sheet: Picker?, attach: Attach, onSheet: (Picker?) -> Unit) {
    when (sheet) {
        Picker.Add -> AddSheet(s, uploading, session, attach, onSheet)
        Picker.Settings -> ChatSettingsSheet(hub, session, run, onSheet)
        Picker.Effort -> PickerSheet("Select effort", effortsFor(session?.models.orEmpty(), session?.model).map { Choice(it, EFFORT_LABEL[it] ?: it) }, session?.effort, { hub.setEffort(it) }) { onSheet(null) }
        Picker.Build -> {
            val flow = session?.buildFlow == true
            PickerSheet("Build", BUILD_CHOICES, if (flow) "flow" else "off", { v ->
                if ((v == "flow") != flow) hub.setBuildFlow(v == "flow")
            }) { onSheet(null) }
        }
        Picker.Account -> PickerSheet("Select Claude account", (session?.accounts?.ifEmpty { null } ?: listOf(session?.account ?: "main")).map { Choice(it, ACCOUNT_LABEL[it] ?: it, listOfNotNull(ACCOUNT_NOTE[it], usageText(session?.usage).ifEmpty { null }?.takeIf { _ -> it == (session?.account ?: "main") }).joinToString(" · ")) }, session?.account ?: "main", { hub.setAccount(it) }) { onSheet(null) }
        Picker.SendAt -> {
            val replaced = run?.kind?.takeIf { it == "goal" || it == "loop" }
            val ahead = ZonedDateTime.now(codexZone).plusHours(1)
            TimeDialog("Send at ${laterDay(ahead.hour, 0)}" + (replaced?.let { " · Replaces the running $it" } ?: ""), ahead.hour, 0, "Send", "Cancel", { h, m -> onSheet(null); s.sendAt("%02d:%02d".format(h, m), uploading) }, { onSheet(null) }, { onSheet(null) })
        }
        Picker.Mcp -> Sheet({ onSheet(null) }, "Use an MCP server", padded = false, full = false) {
            Group {
                connectedServers(session).forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    ListRow(m.name, plural(m.tools?.size ?: 0, "tool"), onClick = { s.useServer = m.name; onSheet(Picker.McpTools) }, trailing = { Chevron() })
                }
            }
        }
        Picker.McpTools -> {
            val server = s.useServer.orEmpty()
            val pick = { use: Use -> s.uses = addUse(s.uses, use); onSheet(null) }
            Sheet({ onSheet(null) }, "Tool from $server", padded = false, full = false) {
                Group {
                    ListRow("Any tool", "The agent picks", onClick = { pick(Use(server)) })
                    connectedServers(session).firstOrNull { it.name == server }?.tools.orEmpty().forEach { t ->
                        Hairline()
                        ListRow(t.name, t.description.ifBlank { null }, onClick = { pick(Use(server, t.name)) })
                    }
                }
            }
        }
        null -> {}
    }
}

private fun connectedServers(session: SessionInfo?) = session?.mcp.orEmpty().filter { it.status == "connected" }

@Composable
private fun AddSheet(s: ComposerState, uploading: Int, session: SessionInfo?, attach: Attach, onSheet: (Picker?) -> Unit) {
    val c = av
    val pct = contextPercent(session?.context, session?.contextWindow)
    val icon = { name: String -> @Composable { AvIcon(name, null, Tokens.iconMd, tint = c.fgMuted) } }
    val settings = settingsLabel(modelName(session), session?.permissionMode ?: "default", session?.review == true, session?.provider)
    Sheet({ onSheet(null) }, "Add", padded = false, full = false) {
        Group {
            ListRow("Photo", leading = icon("file-media"), onClick = { onSheet(null); attach.choosePhoto() })
            Hairline(lead = true)
            ListRow("Take photo", leading = icon("device-camera"), onClick = { onSheet(null); attach.takePhoto() })
            Hairline(lead = true)
            ListRow("Choose file", leading = icon("file"), onClick = { onSheet(null); attach.chooseFile() })
            if (session?.capabilities?.mcp == true && connectedServers(session).isNotEmpty()) {
                Hairline(lead = true)
                ListRow("Use an MCP server", leading = icon("plug"), onClick = { onSheet(Picker.Mcp) }, trailing = { Chevron() })
            }
            Hairline(lead = true)
            ListRow("Chat settings", settings, leading = icon("settings-gear"), onClick = { onSheet(Picker.Settings) }, trailing = { Chevron() })
            if (session?.capabilities?.build == true) {
                Hairline(lead = true)
                ListRow("Build the brief", "Spec, review, build and test the text in the composer", leading = icon("tools"), onClick = { onSheet(null); s.build(uploading) })
            }
            if (s.text.text.isNotBlank()) {
                Hairline(lead = true)
                ListRow("Send at", "Send this message at a time today or tomorrow", leading = icon("clock"), onClick = { onSheet(Picker.SendAt) })
            }
            if (pct != null && pct >= 50) {
                Hairline(lead = true)
                ListRow("$pct% context", leading = icon("pulse"))
            }
        }
    }
}

@Composable
private fun ChatSettingsSheet(hub: Hub, session: SessionInfo?, run: ChatRun?, onSheet: (Picker?) -> Unit) {
    val c = av
    Sheet({ onSheet(null) }, "Chat settings", padded = false, full = false) {
        val account = session?.account ?: "main"
        val caps = session?.capabilities ?: Capabilities()
        val models = session?.models.orEmpty()
        val effort = session?.effort?.takeIf { caps.effort }
        SectionHeader("Run")
        val review = session?.review == true
        val modes = menuModes(session?.provider, session?.permissionMode ?: "default", review)
        Group {
            modes.list.forEachIndexed { i, m ->
                if (i > 0) Hairline()
                ChoiceRow(m.label, m.detail, checked = m.value == modes.checked, onClick = {
                    val (mode, reviewOn) = modeSteps(session?.permissionMode ?: "default", review, m.value)
                    mode?.let { hub.setMode(it) }
                    reviewOn?.let { hub.setReview(it) }
                    onSheet(null)
                })
            }
        }
        if (models.isNotEmpty()) {
            val current = session?.model
            var all by remember { mutableStateOf(false) }
            val newest = newestModels(models, current)
            Group {
                (if (all) models else newest).forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    ChoiceRow(m.displayName.ifBlank { m.value }, m.description, onClick = { hub.setModel(m.value); onSheet(null) }, checked = m.value == current)
                }
                if (!all && newest.size < models.size) {
                    Hairline()
                    ListRow("Older models", "${models.size - newest.size} more", onClick = { all = true }, trailing = { Chevron() })
                }
            }
        }
        val showAccount = (session?.accounts?.size ?: 0) > 1 || account != "main"
        if (showAccount || effort != null) Group {
            effort?.let { ListRow("Effort", EFFORT_LABEL[it] ?: it, onClick = { onSheet(Picker.Effort) }, trailing = { Chevron() }) }
            if (showAccount) { if (effort != null) Hairline(); ListRow("Account", ACCOUNT_LABEL[account] ?: account, onClick = { hub.refreshUsage(); onSheet(Picker.Account) }, trailing = { Chevron() }) }
        }
        SectionHeader("Goal")
        Group {
            // Tries and jobs have their controls on the loop card only.
            val ended by hub.store.state.select { st -> endedRun(st.runs, st.shownId) }
            val opens = run == null || runDetail(run).opens
            val open = { sheet: GoalSheet -> hub.shell.goalSheet.value = sheet; onSheet(null) }
            ListRow(
                "Goal",
                run?.let { runLine(it) } ?: ended?.let { finishedLine(it.why, it.endedAt, ::since) ?: "Ended" } ?: "Off",
                onClick = if (opens) ({ open(run?.let { GoalSheet.Detail(it.id) } ?: ended?.let { GoalSheet.Detail(it.id) } ?: GoalSheet.Start(here = true)) }) else null,
                trailing = { if (opens) Chevron() },
            )
            ended?.let { e ->
                Hairline()
                if (e.kind == "goal") ListRow("Run again…", firstLine(e.what), onClick = { open(GoalSheet.Start(here = true, from = e)) }, trailing = { Chevron() })
                else ListRow("New goal…", "Start a goal in this chat", onClick = { open(GoalSheet.Start(here = true)) }, trailing = { Chevron() })
            }
            Hairline()
            ListRow("Build", if (session?.buildFlow == true) "Spec flow" else "Off", onClick = { onSheet(Picker.Build) }, trailing = { Chevron() })
        }
    }
}

@Composable
private fun SendCircle(label: String, enabled: Boolean, onClick: () -> Unit, glyph: @Composable () -> Unit) {
    Box(Modifier.size(Tokens.touch).semantics { contentDescription = label }.clickable(enabled = enabled, onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(Modifier.size(Tokens.sp20).clip(CircleShape).background(if (enabled) av.fg else av.hover), contentAlignment = Alignment.Center) { glyph() }
    }
}

@Composable
private fun PickerSheet(title: String, items: List<Choice>, current: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    Sheet(onDismiss, title, padded = false, full = false) {
        Group {
            items.forEachIndexed { i, c ->
                if (i > 0) Hairline()
                ChoiceRow(c.label, c.detail, checked = c.value == current, onClick = { onPick(c.value); onDismiss() })
            }
        }
    }
}

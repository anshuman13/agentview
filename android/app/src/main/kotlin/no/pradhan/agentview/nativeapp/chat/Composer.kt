package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import no.pradhan.agentview.nativeapp.codex.autopilot.runLine
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.net.interrupt
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.refreshUsage
import no.pradhan.agentview.nativeapp.net.runControl
import no.pradhan.agentview.nativeapp.net.runInTerminal
import no.pradhan.agentview.nativeapp.net.setAccount
import no.pradhan.agentview.nativeapp.net.setEffort
import no.pradhan.agentview.nativeapp.net.setMode
import no.pradhan.agentview.nativeapp.net.setModel
import no.pradhan.agentview.nativeapp.net.submit
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.ChipTone
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.RowLabel
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.WordClamp
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.well

private class Choice(val value: String, val label: String, val detail: String = "")

private enum class Picker { Settings, Effort, Account }

private class ComposerState(val hub: Hub, val chatId: String) {
    var text by mutableStateOf(hub.draft(chatId).let { TextFieldValue(it, TextRange(it.length)) })
    var goal by mutableStateOf("off")
    var dismissed by mutableStateOf("")
    var files by mutableStateOf<List<String>?>(null)
    val goalOn get() = goal != "off"

    fun set(v: TextFieldValue) { text = v; hub.setDraft(chatId, v.text) }

    fun submit(steer: Boolean, uploading: Int) {
        val t = text.text
        if (t.isBlank() || uploading > 0) return
        shellCommand(t)?.let { if (hub.runInTerminal(it)) set(TextFieldValue("")); return }
        set(TextFieldValue(""))
        val sent = goalText(goal, t, System.currentTimeMillis())
        if (sent != t) goal = "off"
        hub.submit(sent, steer) { val back = restoreUnsent(text.text, t); set(TextFieldValue(back, TextRange(back.length))) }
    }
}

@Composable
fun Composer(hub: Hub, chatId: String, session: SessionInfo?, running: Boolean, waiting: Boolean, run: ChatRun?) {
    val s = remember(chatId) { ComposerState(hub, chatId) }
    val dictation = remember(chatId) { Dictation() }
    var sheet by remember { mutableStateOf<Picker?>(null) }
    var uploading by remember { mutableIntStateOf(0) }
    val trigger = commandTrigger(s.text.text, s.text.selection.end)
    val suggestions = rememberSuggestions(s, trigger, session)
    val c = av
    val card = RoundedCornerShape(Tokens.radius)
    Column(Modifier.fillMaxWidth().background(c.bg).padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        if (suggestions.isNotEmpty()) SuggestionList(suggestions) { sg ->
            val r = acceptSuggestion(s.text.text, trigger!!.start, s.text.selection.end, sg.insert)
            s.set(TextFieldValue(r.first, TextRange(r.second)))
        }
        Column(Modifier.fillMaxWidth().clip(card).background(c.raised).border(BorderStroke(Tokens.hairline, c.border), card)) {
            ComposerInput(s, composerPlaceholder(s.goalOn, waiting, session?.compacting == true, running))
            ComposerToolbar(hub, s, session, running, uploading, { uploading += it }, dictation) { sheet = Picker.Settings }
        }
    }
    ComposerSheets(hub, s, session, run, sheet) { sheet = it }
}

private fun composerPlaceholder(goalOn: Boolean, waiting: Boolean, compacting: Boolean, running: Boolean) = when {
    goalOn -> GOAL_PLACEHOLDER
    waiting -> "Answer above, or message Claude to stop and send"
    compacting -> "Sends when compacting is done"
    running -> "Claude reads this at its next step"
    else -> "Ask anything, / for commands, @ for files"
}

@Composable
private fun rememberSuggestions(s: ComposerState, trigger: Trigger?, session: SessionInfo?): List<Suggestion> {
    val key = trigger?.let { "${it.start}:${it.query}" } ?: ""
    LaunchedEffect(s.chatId, trigger?.file) {
        if (trigger?.file == true && s.files == null) s.files = runCatching { protocolJson.decodeFromString<List<String>>(s.hub.api.get("/api/files", s.chatId)) }.getOrDefault(emptyList())
    }
    return when {
        trigger == null || key == s.dismissed -> emptyList()
        trigger.file -> rankFiles(s.files.orEmpty(), trigger.query).map { f -> Suggestion(f.substringAfterLast('/'), f.substringBeforeLast('/', ""), "@$f") }
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
private fun ComposerInput(s: ComposerState, placeholder: String) {
    val c = av
    BasicTextField(
        value = s.text,
        onValueChange = { s.set(it) },
        modifier = Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4),
        textStyle = Type.body.copy(color = c.fg),
        cursorBrush = SolidColor(c.accent),
        maxLines = 6,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        decorationBox = { inner ->
            Box(Modifier.heightIn(min = Tokens.sp20)) {
                if (s.text.text.isEmpty()) WordClamp(androidx.compose.ui.text.AnnotatedString(placeholder), Type.body, c.fgMuted, 2)
                inner()
            }
        },
    )
}

@Composable
private fun ComposerToolbar(hub: Hub, s: ComposerState, session: SessionInfo?, running: Boolean, uploading: Int, onUploading: (Int) -> Unit, dictation: Dictation, onSettings: () -> Unit) {
    val c = av
    val text = s.text
    val typed = text.text.isNotBlank()
    val pct = contextPercent(session?.context)
    Row(Modifier.fillMaxWidth().padding(start = Tokens.sp2, end = Tokens.sp4, bottom = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
        AttachButton(hub, onUploading) { path -> val t = appendWord(text.text, "[Image: $path] "); s.set(TextFieldValue(t, TextRange(t.length))) }
        Row(Modifier.weight(1f)) {
            if (!(running && typed)) {
                val account = session?.account ?: "main"
                val high = usageHigh(session?.usage)
                Chip(settingsLabel(modelName(session), session?.permissionMode ?: "default") + (if (s.goalOn) " · ${goalInfo(s.goal, System.currentTimeMillis()).chip}" else ""), onSettings, Modifier.weight(1f, fill = false), warn = high, tone = if (account == "main") ChipTone.Personal else ChipTone.Work, icon = if (high) "warning" else if (s.goalOn) "sync" else null)
            }
        }
        if (uploading > 0) RowLabel("Uploading…", c.fgMuted)
        if (pct != null && pct >= 50) RowLabel("$pct%", if (pct >= 75) c.warn else c.fgMuted)
        VoiceButton({ spoken, final -> dictation.apply(text.text, text.selection.end, spoken, final)?.let { (t, caret) -> s.set(TextFieldValue(t, TextRange(caret))) } }, { hub.notice.value = it })
        if (running && typed) Button("Stop and send", { s.submit(true, uploading) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        val canSend = typed && uploading == 0
        val haptic = LocalHapticFeedback.current
        if (running && !typed) SendCircle("Stop", true, hub::interrupt) { Box(Modifier.size(Tokens.sp6).background(c.sunken, RoundedCornerShape(Tokens.radiusXs))) }
        else SendCircle(if (running) "Queue" else "Send", canSend, { haptic.performHapticFeedback(HapticFeedbackType.Confirm); s.submit(false, uploading) }) { AvIcon("send", null, Tokens.iconLg, tint = if (canSend) c.sunken else c.fgFaint) }
    }
}

@Composable
private fun ComposerSheets(hub: Hub, s: ComposerState, session: SessionInfo?, run: ChatRun?, sheet: Picker?, onSheet: (Picker?) -> Unit) {
    when (sheet) {
        Picker.Settings -> ChatSettingsSheet(hub, s, session, run, onSheet)
        Picker.Effort -> PickerSheet("Select effort", EFFORT_LEVELS.map { Choice(it, EFFORT_LABEL[it] ?: it) }, session?.effort, { hub.setEffort(it) }) { onSheet(null) }
        Picker.Account -> PickerSheet("Select Claude account", (session?.accounts?.ifEmpty { null } ?: listOf(session?.account ?: "main")).map { Choice(it, ACCOUNT_LABEL[it] ?: it, listOfNotNull(ACCOUNT_NOTE[it], usageText(session?.usage).ifEmpty { null }?.takeIf { _ -> it == (session?.account ?: "main") }).joinToString(" · ")) }, session?.account ?: "main", { hub.setAccount(it) }) { onSheet(null) }
        null -> {}
    }
}

@Composable
private fun ChatSettingsSheet(hub: Hub, s: ComposerState, session: SessionInfo?, run: ChatRun?, onSheet: (Picker?) -> Unit) {
    val c = av
    Sheet({ onSheet(null) }, "Chat settings", padded = false, full = false) {
        val account = session?.account ?: "main"
        val caps = session?.capabilities ?: Capabilities()
        val models = modelsFor(session?.models.orEmpty(), caps)
        val effort = session?.effort?.takeIf { caps.effort }
        if (models.isNotEmpty()) {
            SectionHeader("Model")
            val current = if (session?.team == true) "team" else session?.model
            Group {
                models.forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    ListRow(m.displayName.ifBlank { m.value }, m.description, onClick = { hub.setModel(m.value); onSheet(null) }, trailing = if (m.value == current) { { AvIcon("check", "Selected", Tokens.icon, tint = c.accentText) } } else null)
                }
            }
        }
        SectionHeader("Goal")
        Group {
            goalChoices(System.currentTimeMillis()).forEachIndexed { i, g ->
                if (i > 0) Hairline()
                val detail = if (g.value == "off" && run != null) runLine(run, session?.loop?.phase) else g.detail
                ListRow(g.label, detail, onClick = { if (g.value == "off" && run != null) hub.runControl(run, "stop"); s.goal = g.value; onSheet(null) }, trailing = if (g.value == s.goal) { { AvIcon("check", "Selected", Tokens.icon, tint = c.accentText) } } else null)
            }
        }
        SectionHeader("Permission mode")
        Group {
            PERMISSION_MODES.forEachIndexed { i, m ->
                if (i > 0) Hairline()
                ListRow(MODES[m]?.label ?: m, MODES[m]?.detail, onClick = { hub.setMode(m); onSheet(null) }, trailing = if (m == (session?.permissionMode ?: "default")) { { AvIcon("check", "Selected", Tokens.icon, tint = c.accentText) } } else null)
            }
        }
        val showAccount = (session?.accounts?.size ?: 0) > 1 || account != "main" || session?.usage != null
        if (showAccount || effort != null) SectionHeader("Account and effort")
        if (showAccount || effort != null) Group {
            if (showAccount) ListRow("Account", ACCOUNT_LABEL[account] ?: account, onClick = { hub.refreshUsage(); onSheet(Picker.Account) }, trailing = { Chevron() })
            effort?.let { if (showAccount) Hairline(); ListRow("Effort", EFFORT_LABEL[it] ?: it, onClick = { onSheet(Picker.Effort) }, trailing = { Chevron() }) }
        }
    }
}

@Composable
private fun SendCircle(label: String, enabled: Boolean, onClick: () -> Unit, glyph: @Composable () -> Unit) {
    Box(Modifier.size(Tokens.touch).clickable(enabled = enabled, onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(Modifier.size(Tokens.sp20).clip(CircleShape).background(if (enabled) av.fg else av.hover), contentAlignment = Alignment.Center) { glyph() }
    }
}

@Composable
private fun PickerSheet(title: String, items: List<Choice>, current: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    Sheet(onDismiss, title, padded = false, full = false) {
        Group {
            items.forEachIndexed { i, c ->
                if (i > 0) Hairline()
                ListRow(
                    c.label, c.detail,
                    onClick = { onPick(c.value); onDismiss() },
                    trailing = if (c.value == current) { { AvIcon("check", "Selected", Tokens.icon, tint = av.accentText) } } else null,
                )
            }
        }
    }
}

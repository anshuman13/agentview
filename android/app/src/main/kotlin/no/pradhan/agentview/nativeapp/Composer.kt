package no.pradhan.agentview.nativeapp

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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.TextFieldValue

private class Choice(val value: String, val label: String, val detail: String = "")

private enum class Picker { Settings, Effort, Account }

@Composable
fun Composer(hub: Hub, chatId: String, session: SessionInfo?, running: Boolean, waiting: Boolean) {
    var text by remember(chatId) { mutableStateOf(hub.draft(chatId).let { TextFieldValue(it, TextRange(it.length)) }) }
    val dictation = remember(chatId) { Dictation() }
    var dismissed by remember(chatId) { mutableStateOf("") }
    var sheet by remember { mutableStateOf<Picker?>(null) }
    var uploading by remember { mutableIntStateOf(0) }
    val compacting = session?.compacting == true
    val typed = text.text.isNotBlank()

    fun set(v: TextFieldValue) { text = v; hub.setDraft(chatId, v.text) }

    val trigger = commandTrigger(text.text, text.selection.end)
    val key = trigger?.let { "${it.start}:${it.query}" } ?: ""
    var files by remember(chatId) { mutableStateOf<List<String>?>(null) }
    LaunchedEffect(chatId, trigger?.file) {
        if (trigger?.file == true && files == null) files = runCatching { protocolJson.decodeFromString<List<String>>(hub.api.get("/api/files", chatId)) }.getOrDefault(emptyList())
    }
    val suggestions = when {
        trigger == null || key == dismissed -> emptyList()
        trigger.file -> rankFiles(files.orEmpty(), trigger.query).map { f -> Suggestion(f.substringAfterLast('/'), f.substringBeforeLast('/', ""), "@$f") }
        else -> rankCommands(session?.commands ?: emptyList(), trigger.query).map { Suggestion("/${it.name}", it.description, "/${it.name}") }
    }

    fun submit(steer: Boolean) {
        val t = text.text
        if (t.isBlank() || uploading > 0) return
        shellCommand(t)?.let { if (hub.runInTerminal(it)) set(TextFieldValue("")); return }
        set(TextFieldValue(""))
        hub.submit(t, steer) { val back = restoreUnsent(text.text, t); set(TextFieldValue(back, TextRange(back.length))) }
    }

    val placeholder = when {
        waiting -> "Answer above, or message Claude to stop and send"
        compacting -> "Sends when compacting is done"
        running -> "Claude reads this at its next step"
        else -> "Ask anything, / for commands, @ for files"
    }
    val pct = contextPercent(session?.context)

    val c = av
    val card = RoundedCornerShape(Tokens.radius)
    Column(Modifier.fillMaxWidth().background(c.bg).padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        if (suggestions.isNotEmpty()) Column(Modifier.fillMaxWidth().heightIn(max = Tokens.imageMax).well(c).verticalScroll(rememberScrollState())) {
            for (s in suggestions) Column(
                Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clickable {
                    val r = acceptSuggestion(text.text, trigger!!.start, text.selection.end, s.insert)
                    set(TextFieldValue(r.first, TextRange(r.second)))
                }.padding(horizontal = Tokens.sp6, vertical = Tokens.sp3),
            ) {
                Text(s.label, style = Type.body.copy(fontFamily = FontFamily.Monospace), color = c.fg)
                if (s.detail.isNotEmpty()) Text(s.detail, style = Type.footnote, color = c.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Column(Modifier.fillMaxWidth().clip(card).background(c.raised).border(BorderStroke(Tokens.hairline, c.border), card)) {
            BasicTextField(
                value = text,
                onValueChange = { set(it) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4),
                textStyle = Type.body.copy(color = c.fg),
                cursorBrush = SolidColor(c.accent),
                maxLines = 6,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                decorationBox = { inner ->
                    Box(Modifier.heightIn(min = Tokens.sp20)) {
                        if (text.text.isEmpty()) WordClamp(androidx.compose.ui.text.AnnotatedString(placeholder), Type.body, c.fgMuted, 2)
                        inner()
                    }
                },
            )
            Row(Modifier.fillMaxWidth().padding(start = Tokens.sp2, end = Tokens.sp4, bottom = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                AttachButton(hub, { uploading += it }) { path -> val t = appendWord(text.text, "[Image: $path] "); set(TextFieldValue(t, TextRange(t.length))) }
                Row(Modifier.weight(1f)) {
                    if (!(running && typed)) {
                        val account = session?.account ?: "main"
                        val high = usageHigh(session?.usage)
                        Chip(settingsLabel(modelName(session), session?.permissionMode ?: "default"), { sheet = Picker.Settings }, Modifier.weight(1f, fill = false), warn = high, tone = if (account == "main") ChipTone.Personal else ChipTone.Work, icon = if (high) "warning" else null)
                    }
                }
                if (uploading > 0) RowLabel("Uploading", c.fgMuted)
                if (pct != null && pct >= 50) RowLabel("$pct%", if (pct >= 75) c.warn else c.fgMuted)
                VoiceButton({ spoken, final -> dictation.apply(text.text, text.selection.end, spoken, final)?.let { (t, caret) -> set(TextFieldValue(t, TextRange(caret))) } }, { hub.notice.value = it })
                if (running && typed) Button("Stop and send", { submit(true) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                val canSend = typed && uploading == 0
                val haptic = LocalHapticFeedback.current
                if (running && !typed) SendCircle("Stop", true, hub::interrupt) { Box(Modifier.size(Tokens.sp6).background(c.sunken, RoundedCornerShape(Tokens.radiusXs))) }
                else SendCircle(if (running) "Queue" else "Send", canSend, { haptic.performHapticFeedback(HapticFeedbackType.Confirm); submit(false) }) { AvIcon("send", null, Tokens.iconLg, tint = if (canSend) c.sunken else c.fgFaint) }
            }
        }
    }

    when (sheet) {
        Picker.Settings -> Sheet({ sheet = null }, "Chat settings", padded = false, full = false) {
            val account = session?.account ?: "main"
            val models = session?.models.orEmpty()
            if (models.isNotEmpty()) {
                SectionHeader("Model")
                val current = if (session?.team == true) "team" else session?.model
                Group {
                    models.forEachIndexed { i, m ->
                        if (i > 0) Hairline()
                        ListRow(m.displayName.ifBlank { m.value }, m.description, onClick = { hub.setModel(m.value); sheet = null }, trailing = if (m.value == current) { { AvIcon("check", "Selected", Tokens.icon, tint = c.accentText) } } else null)
                    }
                }
            }
            SectionHeader("Permission mode")
            Group {
                PERMISSION_MODES.forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    ListRow(MODES[m]?.label ?: m, MODES[m]?.detail, onClick = { hub.setMode(m); sheet = null }, trailing = if (m == (session?.permissionMode ?: "default")) { { AvIcon("check", "Selected", Tokens.icon, tint = c.accentText) } } else null)
                }
            }
            val showAccount = (session?.accounts?.size ?: 0) > 1 || account != "main" || session?.usage != null
            if (showAccount || session?.effort != null) SectionHeader("Account and effort")
            if (showAccount || session?.effort != null) Group {
                if (showAccount) ListRow("Account", ACCOUNT_LABEL[account] ?: account, onClick = { hub.refreshUsage(); sheet = Picker.Account }, trailing = { Chevron() })
                session?.effort?.let { if (showAccount) Hairline(); ListRow("Effort", EFFORT_LABEL[it] ?: it, onClick = { sheet = Picker.Effort }, trailing = { Chevron() }) }
            }
        }
        Picker.Effort -> PickerSheet("Select effort", EFFORT_LEVELS.map { Choice(it, EFFORT_LABEL[it] ?: it) }, session?.effort, { hub.setEffort(it) }) { sheet = null }
        Picker.Account -> PickerSheet("Select Claude account", (session?.accounts?.ifEmpty { null } ?: listOf(session?.account ?: "main")).map { Choice(it, ACCOUNT_LABEL[it] ?: it, listOfNotNull(ACCOUNT_NOTE[it], usageText(session?.usage).ifEmpty { null }?.takeIf { _ -> it == (session?.account ?: "main") }).joinToString(" · ")) }, session?.account ?: "main", { hub.setAccount(it) }) { sheet = null }
        null -> {}
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

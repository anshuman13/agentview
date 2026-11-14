package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
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
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import no.pradhan.agentview.nativeapp.app.BarEvent
import no.pradhan.agentview.nativeapp.app.BarState
import no.pradhan.agentview.nativeapp.app.barHidden
import no.pradhan.agentview.nativeapp.app.barState
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalSheet
import no.pradhan.agentview.nativeapp.codex.autopilot.runLine
import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.net.chatFiles
import no.pradhan.agentview.nativeapp.net.interrupt
import no.pradhan.agentview.nativeapp.net.menuModes
import no.pradhan.agentview.nativeapp.net.modeSteps
import no.pradhan.agentview.nativeapp.net.newestModels
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.net.refreshUsage
import no.pradhan.agentview.nativeapp.net.runInTerminal
import no.pradhan.agentview.nativeapp.net.setAccount
import no.pradhan.agentview.nativeapp.net.setEffort
import no.pradhan.agentview.nativeapp.net.setLoop
import no.pradhan.agentview.nativeapp.net.setMode
import no.pradhan.agentview.nativeapp.net.setModel
import no.pradhan.agentview.nativeapp.net.setReview
import no.pradhan.agentview.nativeapp.net.submit
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ChoiceRow
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.WordClamp
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.well
import no.pradhan.agentview.nativeapp.ui.plural

private class Choice(val value: String, val label: String, val detail: String = "")

private val LOOP_CHOICES = listOf(Choice("off", "Off", "Prompts run as usual")) + listOf(1, 2, 3, 5).map { Choice(it.toString(), "Up to ${plural(it, "round")}", "Opus plans and builds, Sonnet tests and reports, Opus fixes what fails") }

private enum class Picker { Add, Settings, Effort, Account, Loop }

private class ComposerState(val hub: Hub, val chatId: String) {
    var text by mutableStateOf(hub.draft(chatId).let { TextFieldValue(it, TextRange(it.length)) })
    var dismissed by mutableStateOf("")
    var files by mutableStateOf<List<String>?>(null)

    fun set(v: TextFieldValue) {
        val changed = v.text != text.text
        text = v
        if (changed) hub.setDraft(chatId, v.text)
    }

    private fun restore(sent: String) {
        val back = restoreUnsent(text.text, sent)
        set(TextFieldValue(back, TextRange(back.length)))
    }

    fun build(uploading: Int) {
        when (val step = buildStep(text.text, uploading, hub.readOnly)) {
            is BuildStep.Notice -> hub.notice.value = step.text
            is BuildStep.Send -> {
                set(TextFieldValue(""))
                hub.submit(buildPrompt(step.brief), false) { restore(step.brief) }
            }
        }
    }

    fun submit(steer: Boolean, uploading: Int) {
        val t = text.text
        if (t.isBlank() || uploading > 0) return
        shellCommand(t)?.let { if (hub.runInTerminal(it)) set(TextFieldValue("")); return }
        set(TextFieldValue(""))
        hub.submit(t, steer) { restore(t) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Composer(hub: Hub, chatId: String, session: SessionInfo?, running: Boolean, waiting: Boolean, run: ChatRun?) {
    val s = remember(chatId) { ComposerState(hub, chatId) }
    val dictation = remember(chatId) { Dictation() }
    var sheet by remember { mutableStateOf<Picker?>(null) }
    var uploading by remember { mutableIntStateOf(0) }
    var multiline by remember(chatId) { mutableStateOf(false) }
    val trigger = commandTrigger(s.text.text, s.text.selection.end)
    val suggestions = rememberSuggestions(s, trigger, session)
    val attach = rememberAttach(hub, { uploading += it }) { path -> val t = appendWord(s.text.text, "[Image: $path] "); s.set(TextFieldValue(t, TextRange(t.length))) }
    var bar by remember(chatId) { mutableStateOf(barState(BarState(), if (s.text.text.isEmpty()) BarEvent.TextEmpty else BarEvent.TextFilled)) }
    val imeVisible = WindowInsets.isImeVisible
    LaunchedEffect(imeVisible) { bar = barState(bar, if (imeVisible) BarEvent.KeyboardUp else BarEvent.KeyboardDown) }
    LaunchedEffect(s.text.text.isEmpty()) { bar = barState(bar, if (s.text.text.isEmpty()) BarEvent.TextEmpty else BarEvent.TextFilled) }
    LaunchedEffect(bar) { hub.composing.value = barHidden(bar) }
    DisposableEffect(chatId) { onDispose { hub.composing.value = false } }
    val c = av
    val shape = RoundedCornerShape(if (multiline) Tokens.radius else Tokens.radiusPill)
    Column(Modifier.fillMaxWidth().background(c.bg).padding(start = Tokens.listPad, end = Tokens.listPad, top = Tokens.sp4, bottom = Tokens.sp2), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        if (suggestions.isNotEmpty()) SuggestionList(suggestions) { sg ->
            val r = acceptSuggestion(s.text.text, trigger!!.start, s.text.selection.end, sg.insert)
            s.set(TextFieldValue(r.first, TextRange(r.second)))
        }
        Row(Modifier.fillMaxWidth().clip(shape).background(c.raised).border(BorderStroke(Tokens.hairline, c.border), shape), verticalAlignment = Alignment.Bottom) {
            if (uploading > 0) Box(Modifier.size(Tokens.touch).semantics { contentDescription = "Uploading" }, contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(Tokens.iconMd), color = c.accent, strokeWidth = Tokens.sp1) }
            else IconBtn("add", "Add", { sheet = Picker.Add })
            ComposerInput(
                s, composerPlaceholder(providerLabel(session?.provider), waiting, session?.compacting == true, running),
                Modifier.weight(1f).onFocusChanged { bar = barState(bar, if (it.isFocused) BarEvent.Focus else BarEvent.Blur) }, { multiline = it },
            )
            ComposerActions(hub, s, running, uploading, dictation)
        }
    }
    ComposerSheets(hub, s, uploading, session, run, sheet, attach) { sheet = it }
}

private fun composerPlaceholder(label: String, waiting: Boolean, compacting: Boolean, running: Boolean) = when {
    waiting -> "Answer above, or message $label to stop and send"
    compacting -> "Sends when compacting is done"
    running -> "$label reads this at its next step"
    else -> "Ask anything, / for commands, @ for files"
}

@Composable
private fun rememberSuggestions(s: ComposerState, trigger: Trigger?, session: SessionInfo?): List<Suggestion> {
    val key = trigger?.let { "${it.start}:${it.query}" } ?: ""
    LaunchedEffect(s.chatId, trigger?.file) {
        if (trigger?.file == true && s.files == null) s.files = runCatching { s.hub.chatFiles(s.chatId) }.getOrDefault(emptyList())
    }
    val files = s.files
    val ranked = remember(files, trigger?.query, trigger?.file) { if (trigger?.file == true) rankFiles(files.orEmpty(), trigger.query) else emptyList() }
    return when {
        trigger == null || key == s.dismissed -> emptyList()
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
    val typed = text.text.isNotBlank()
    var dictating by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    if (!typed || dictating) VoiceButton({ spoken, final -> dictating = !final; dictation.apply(text.text, text.selection.end, spoken, final)?.let { (t, caret) -> s.set(TextFieldValue(t, TextRange(caret))) } }, { hub.notice.value = it })
    if (running && typed) Button("Stop and send", { s.submit(true, uploading) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    val canSend = typed && uploading == 0
    if (running && !typed) SendCircle("Stop", true, hub::interrupt) { Box(Modifier.size(Tokens.sp6).background(c.sunken, RoundedCornerShape(Tokens.radiusXs))) }
    else if (typed && !dictating) SendCircle(if (running) "Queue" else "Send", canSend, { haptic.performHapticFeedback(HapticFeedbackType.Confirm); s.submit(false, uploading) }) { AvIcon("send", null, Tokens.iconLg, tint = if (canSend) c.sunken else c.fgFaint) }
}

@Composable
private fun ComposerSheets(hub: Hub, s: ComposerState, uploading: Int, session: SessionInfo?, run: ChatRun?, sheet: Picker?, attach: Attach, onSheet: (Picker?) -> Unit) {
    when (sheet) {
        Picker.Add -> AddSheet(session, attach, onSheet)
        Picker.Settings -> ChatSettingsSheet(hub, s, uploading, session, run, onSheet)
        Picker.Effort -> PickerSheet("Select effort", effortsFor(session?.models.orEmpty(), session?.model).map { Choice(it, EFFORT_LABEL[it] ?: it) }, session?.effort, { hub.setEffort(it) }) { onSheet(null) }
        Picker.Loop -> PickerSheet("Build cycle", LOOP_CHOICES, session?.loop?.takeIf { it.on }?.max?.toString() ?: "off", { hub.setLoop(it != "off", it.toIntOrNull()) }) { onSheet(null) }
        Picker.Account -> PickerSheet("Select Claude account", (session?.accounts?.ifEmpty { null } ?: listOf(session?.account ?: "main")).map { Choice(it, ACCOUNT_LABEL[it] ?: it, listOfNotNull(ACCOUNT_NOTE[it], usageText(session?.usage).ifEmpty { null }?.takeIf { _ -> it == (session?.account ?: "main") }).joinToString(" · ")) }, session?.account ?: "main", { hub.setAccount(it) }) { onSheet(null) }
        null -> {}
    }
}

@Composable
private fun AddSheet(session: SessionInfo?, attach: Attach, onSheet: (Picker?) -> Unit) {
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
            ListRow("Chat settings", settings, leading = icon("settings-gear"), onClick = { onSheet(Picker.Settings) }, trailing = { Chevron() })
            if (pct != null && pct >= 50) {
                Hairline(lead = true)
                ListRow("$pct% context", leading = icon("pulse"))
            }
        }
    }
}

@Composable
private fun ChatSettingsSheet(hub: Hub, s: ComposerState, uploading: Int, session: SessionInfo?, run: ChatRun?, onSheet: (Picker?) -> Unit) {
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
                if (caps.build) {
                    Hairline()
                    ListRow("Build", "Spec, review, build and test the brief in the composer", onClick = { onSheet(null); s.build(uploading) })
                }
            }
        }
        val showAccount = (session?.accounts?.size ?: 0) > 1 || account != "main"
        if (showAccount || effort != null) Group {
            effort?.let { ListRow("Effort", EFFORT_LABEL[it] ?: it, onClick = { onSheet(Picker.Effort) }, trailing = { Chevron() }) }
            if (showAccount) { if (effort != null) Hairline(); ListRow("Account", ACCOUNT_LABEL[account] ?: account, onClick = { hub.refreshUsage(); onSheet(Picker.Account) }, trailing = { Chevron() }) }
        }
        val loop = session?.loop?.takeIf { it.on }
        SectionHeader("Goal")
        Group {
            // Loops, cycles, tries and jobs have their controls on the loop card only.
            val opens = run == null || run.kind == "goal"
            ListRow("Goal", run?.let { runLine(it, session?.loop?.phase) } ?: "Off", onClick = if (opens) ({ hub.goalSheet.value = run?.let { GoalSheet.Detail(it.id) } ?: GoalSheet.Start(here = true); onSheet(null) }) else null, trailing = { if (opens) Chevron() })
            Hairline()
            ListRow("Build cycle", loop?.let { "Up to ${plural(it.max, "round")}" } ?: "Off", onClick = { onSheet(Picker.Loop) }, trailing = { Chevron() })
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
                ChoiceRow(c.label, c.detail, checked = c.value == current, onClick = { onPick(c.value); onDismiss() })
            }
        }
    }
}

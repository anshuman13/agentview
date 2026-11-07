package no.pradhan.agentview.nativeapp

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private class Choice(val value: String, val label: String, val detail: String = "")

private enum class Picker { Mode, Model, Effort }

@Composable
fun Composer(hub: Hub, chatId: String, session: SessionInfo?, running: Boolean, waiting: Boolean) {
    var text by remember(chatId) { mutableStateOf(TextFieldValue(hub.draft(chatId))) }
    var dismissed by remember(chatId) { mutableStateOf("") }
    var sheet by remember { mutableStateOf<Picker?>(null) }
    var uploading by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val compacting = session?.compacting == true
    val typed = text.text.isNotBlank()

    fun set(v: TextFieldValue) { text = v; hub.setDraft(chatId, v.text) }

    val trigger = commandTrigger(text.text, text.selection.end)
    val key = trigger?.let { "${it.start}:${it.query}" } ?: ""
    val suggestions = if (trigger != null && key != dismissed) rankCommands(session?.commands ?: emptyList(), trigger.query) else emptyList()

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            uploading++
            val mime = ctx.contentResolver.getType(uri) ?: "image/jpeg"
            val bytes = withContext(Dispatchers.IO) { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
            val path = bytes?.let { hub.attach("photo.${mime.substringAfter('/', "jpg").substringBefore('+')}", mime, it) }
            uploading--
            if (path != null) { val t = appendWord(text.text, "[Image: $path] "); set(TextFieldValue(t, TextRange(t.length))) }
        }
    }

    fun submit(steer: Boolean) {
        val t = text.text
        if (t.isBlank() || uploading > 0) return
        set(TextFieldValue(""))
        hub.submit(t, steer) { if (text.text.isBlank()) set(TextFieldValue(t, TextRange(t.length))) }
    }

    val placeholder = when {
        waiting -> "Answer above, or message Claude to stop and send"
        compacting -> "Sends when compacting is done"
        running -> "Claude reads this at its next step"
        else -> "Ask anything, / for commands"
    }
    val pct = contextPercent(session?.context)

    val c = av
    val card = RoundedCornerShape(Tokens.radius)
    Column(Modifier.fillMaxWidth().background(c.bg).padding(start = Tokens.sp4, end = Tokens.sp4, bottom = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        if (suggestions.isNotEmpty()) Column(Modifier.fillMaxWidth().heightIn(max = Tokens.imageMax).well(c).verticalScroll(rememberScrollState())) {
            for (s in suggestions) Column(
                Modifier.fillMaxWidth().heightIn(min = Tokens.touchMd).clickable {
                    val r = acceptSuggestion(text.text, trigger!!.start, text.selection.end, "/${s.name}")
                    set(TextFieldValue(r.first, TextRange(r.second)))
                }.padding(horizontal = Tokens.sp6, vertical = Tokens.sp3),
            ) {
                Text("/${s.name}", style = Mono.copy(fontSize = Tokens.fsLg), color = c.fg)
                if (s.description.isNotEmpty()) Text(s.description, style = Type.footnote, color = c.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Column(Modifier.fillMaxWidth().clip(card).background(c.raised).border(BorderStroke(Tokens.hairline, c.border), card)) {
            BasicTextField(
                value = text,
                onValueChange = { set(it) },
                modifier = Modifier.fillMaxWidth().padding(start = Tokens.sp6, end = Tokens.sp6, top = Tokens.sp5, bottom = Tokens.sp1),
                textStyle = Type.body.copy(fontSize = Tokens.fsLg, lineHeight = Tokens.lineMd, color = c.fg),
                cursorBrush = SolidColor(c.accent),
                maxLines = 6,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                decorationBox = { inner ->
                    Box(Modifier.heightIn(min = Tokens.sp16)) {
                        if (text.text.isEmpty()) WordClamp(androidx.compose.ui.text.AnnotatedString(placeholder), Type.body.copy(fontSize = Tokens.fsLg, lineHeight = Tokens.lineMd), c.fgFaint, 2)
                        inner()
                    }
                },
            )
            Row(Modifier.fillMaxWidth().padding(start = Tokens.sp2, end = Tokens.sp4, bottom = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp2), verticalAlignment = Alignment.CenterVertically) {
                IconBtn("add", "Attach image", { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
                Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Tokens.sp2), verticalAlignment = Alignment.CenterVertically) {
                    Chip(MODES[session?.permissionMode ?: "default"]?.label ?: session?.permissionMode ?: "Default", { sheet = Picker.Mode }, trailingIcon = "chevron-down")
                    Chip(shortModel(modelName(session)), { sheet = Picker.Model }, trailingIcon = "chevron-down")
                    session?.effort?.let { Chip(EFFORT_LABEL[it] ?: it, { sheet = Picker.Effort }, trailingIcon = "chevron-down") }
                }
                if (uploading > 0) RowLabel("Uploading", c.fgFaint)
                if (pct != null && pct >= 50) RowLabel("$pct%", if (pct >= 75) c.warn else c.fgFaint)
                if (running && typed) Button("Stop and send", { submit(true) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                val canSend = typed && uploading == 0
                val haptic = LocalHapticFeedback.current
                if (running && !typed) SendCircle("Stop", true, hub::interrupt) { Box(Modifier.size(Tokens.sp5).background(c.sunken, RoundedCornerShape(Tokens.radiusXs))) }
                else SendCircle(if (running) "Queue" else "Send", canSend, { haptic.performHapticFeedback(HapticFeedbackType.Confirm); submit(false) }) { AvIcon("send", null, Tokens.iconSm, tint = if (canSend) c.sunken else c.fgFaint) }
            }
        }
    }

    when (sheet) {
        Picker.Mode -> PickerSheet("Permission mode", PERMISSION_MODES.map { Choice(it, MODES[it]?.label ?: it, MODES[it]?.detail ?: "") }, session?.permissionMode ?: "default", { hub.setMode(it) }) { sheet = null }
        Picker.Model -> PickerSheet("Select model", (session?.models ?: emptyList()).map { Choice(it.value, it.displayName, it.description) }, if (session?.team == true) "team" else session?.model, { hub.setModel(it) }) { sheet = null }
        Picker.Effort -> PickerSheet("Select effort", EFFORT_LEVELS.map { Choice(it, EFFORT_LABEL[it] ?: it) }, session?.effort, { hub.setEffort(it) }) { sheet = null }
        null -> {}
    }
}

@Composable
private fun SendCircle(label: String, enabled: Boolean, onClick: () -> Unit, glyph: @Composable () -> Unit) {
    Box(Modifier.size(Tokens.touch).clickable(enabled = enabled, onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(Modifier.size(Tokens.sizeXl).clip(CircleShape).background(if (enabled) av.fg else av.hover), contentAlignment = Alignment.Center) { glyph() }
    }
}

@Composable
private fun PickerSheet(title: String, items: List<Choice>, current: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    Sheet(onDismiss, padded = false, full = false) {
        SectionHeader(title)
        for (c in items) ListRow(
            c.label, c.detail,
            onClick = { onPick(c.value); onDismiss() },
            trailing = if (c.value == current) { { AvIcon("check", "Selected", Tokens.icon, tint = av.accentText) } } else null,
        )
    }
}

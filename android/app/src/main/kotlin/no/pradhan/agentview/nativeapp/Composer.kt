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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private class Choice(val value: String, val label: String, val detail: String = "")

private enum class Sheet { Mode, Model, Effort }

@Composable
fun Composer(hub: Hub, chatId: String, session: SessionInfo?, running: Boolean, waiting: Boolean) {
    var text by remember(chatId) { mutableStateOf(TextFieldValue(hub.draft(chatId))) }
    var dismissed by remember(chatId) { mutableStateOf("") }
    var sheet by remember { mutableStateOf<Sheet?>(null) }
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

    Column(Modifier.fillMaxWidth().background(av.bg)) {
        if (suggestions.isNotEmpty()) Column(Modifier.fillMaxWidth().heightIn(max = 280.dp).background(av.surface).verticalScroll(rememberScrollState())) {
            for (c in suggestions) Column(
                Modifier.fillMaxWidth().clickable {
                    val r = acceptSuggestion(text.text, trigger!!.start, text.selection.end, "/${c.name}")
                    set(TextFieldValue(r.first, TextRange(r.second)))
                }.padding(horizontal = Sp.s8, vertical = Sp.s4),
            ) {
                Text("/${c.name}", fontFamily = FontFamily.Monospace, fontSize = 14.sp)
                if (c.description.isNotEmpty()) Text(c.description, style = MaterialTheme.typography.labelSmall, color = av.fgMuted, maxLines = 1)
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = Sp.s6, vertical = Sp.s2), horizontalArrangement = Arrangement.spacedBy(Sp.s4), verticalAlignment = Alignment.CenterVertically) {
            Chip(MODES[session?.permissionMode ?: "default"]?.label ?: session?.permissionMode ?: "Default") { sheet = Sheet.Mode }
            Chip(shortModel(modelName(session))) { sheet = Sheet.Model }
            session?.effort?.let { Chip(EFFORT_LABEL[it] ?: it) { sheet = Sheet.Effort } }
            Box(Modifier.weight(1f))
            if (uploading > 0) Text("Uploading", style = MaterialTheme.typography.labelSmall, color = av.fgFaint)
            if (pct != null && pct >= 50) Text("$pct%", style = MaterialTheme.typography.labelSmall, color = if (pct >= 75) av.warn else av.fgFaint)
            if (running && typed) Text("Stop and send", style = MaterialTheme.typography.labelMedium, color = av.accentText, modifier = Modifier.clickable { submit(true) }.padding(vertical = Sp.s3, horizontal = Sp.s2))
        }
        Row(Modifier.fillMaxWidth().padding(start = Sp.s2, end = Sp.s4, bottom = Sp.s4), verticalAlignment = Alignment.Bottom) {
            IconButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, modifier = Modifier.size(Sp.touch)) { Icon(Icons.Filled.Add, "Attach image", tint = av.fgMuted) }
            Box(
                Modifier.weight(1f).heightIn(min = Sp.touch).background(av.surface, RoundedCornerShape(22.dp)).border(BorderStroke(1.dp, av.border), RoundedCornerShape(22.dp)).padding(horizontal = Sp.s7, vertical = Sp.s5),
                contentAlignment = Alignment.CenterStart,
            ) {
                BasicTextField(
                    value = text,
                    onValueChange = { set(it) },
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(color = av.fg),
                    cursorBrush = SolidColor(av.accent),
                    maxLines = 6,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    decorationBox = { inner ->
                        if (text.text.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyMedium, color = av.fgFaint, maxLines = 1)
                        inner()
                    },
                )
            }
            if (running && !typed) {
                IconButton(onClick = hub::interrupt, modifier = Modifier.size(Sp.touch)) {
                    Box(Modifier.size(14.dp).background(av.err, RoundedCornerShape(2.dp)))
                }
            } else {
                IconButton(onClick = { submit(false) }, enabled = typed && uploading == 0, modifier = Modifier.size(Sp.touch)) {
                    Icon(Icons.AutoMirrored.Filled.Send, if (running) "Queue" else "Send", tint = if (typed && uploading == 0) av.accentText else av.fgFaint)
                }
            }
        }
    }

    when (sheet) {
        Sheet.Mode -> PickerSheet("Permission mode", PERMISSION_MODES.map { Choice(it, MODES[it]?.label ?: it, MODES[it]?.detail ?: "") }, session?.permissionMode ?: "default", { hub.setMode(it) }) { sheet = null }
        Sheet.Model -> PickerSheet("Select model", (session?.models ?: emptyList()).map { Choice(it.value, it.displayName, it.description) }, if (session?.team == true) "team" else session?.model, { hub.setModel(it) }) { sheet = null }
        Sheet.Effort -> PickerSheet("Select effort", EFFORT_LEVELS.map { Choice(it, EFFORT_LABEL[it] ?: it) }, session?.effort, { hub.setEffort(it) }) { sheet = null }
        null -> {}
    }
}

@Composable
private fun Chip(label: String, onClick: () -> Unit) {
    Text(
        "$label ▾",
        Modifier.background(av.surface, RoundedCornerShape(999.dp)).clickable(onClick = onClick).padding(horizontal = Sp.s5, vertical = Sp.s3),
        style = MaterialTheme.typography.labelMedium,
        color = av.fgMuted,
        maxLines = 1,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PickerSheet(title: String, items: List<Choice>, current: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = av.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = Sp.s8)) {
            Text(title, Modifier.padding(horizontal = Sp.s8, vertical = Sp.s4), style = MaterialTheme.typography.labelMedium, color = av.fgMuted)
            for (c in items) Row(
                Modifier.fillMaxWidth().clickable { onPick(c.value); onDismiss() }.padding(horizontal = Sp.s8, vertical = Sp.s5).heightIn(min = Sp.touch),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Sp.s6),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(c.label, style = MaterialTheme.typography.bodyLarge)
                    if (c.detail.isNotEmpty()) Text(c.detail, style = MaterialTheme.typography.labelMedium, color = av.fgMuted)
                }
                if (c.value == current) Box(Modifier.size(8.dp).background(av.accentText, CircleShape))
            }
        }
    }
}

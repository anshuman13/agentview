package no.pradhan.agentview.nativeapp.workspace

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.saveFile
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

class DocEditState {
    var editing by mutableStateOf<DocBlock?>(null)
    var asking by mutableStateOf<DocBlock?>(null)
}

// The rendered file, one block per item: a long press offers Ask Claude and Edit (web DocEdit.tsx).
fun LazyListScope.docBlockItems(hub: Hub, path: String, text: String, blocks: List<DocBlock>, state: DocEditState, reload: () -> Unit) {
    itemsIndexed(blocks, key = { i, b -> "$i:${b.start}" }) { _, b ->
        Box(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2)) {
            if (state.editing == b) BlockEditor(b.raw, onCancel = { state.editing = null }) { value, done -> saveBlock(hub, path, text, b, value) { ok -> done(ok); if (ok) { state.editing = null; reload() } } }
            else DocBlockView(hub, b, state)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DocBlockView(hub: Hub, b: DocBlock, state: DocEditState) {
    var menu by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    Box(Modifier.fillMaxWidth().combinedClickable(onClick = {}, onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); menu = true })) {
        Markdown(b.raw, Modifier.fillMaxWidth())
        Menu(menu, { menu = false }) {
            MenuItem("Ask Claude", "sparkle", { menu = false; state.asking = b }, enabled = !hub.readOnly)
            MenuItem("Edit", "edit", { menu = false; state.editing = b }, enabled = !hub.readOnly)
        }
    }
}

@Composable
private fun BlockEditor(raw: String, onCancel: () -> Unit, onSave: (String, (Boolean) -> Unit) -> Unit) {
    var value by remember(raw) { mutableStateOf(raw.trimEnd()) }
    var saving by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().imePadding(), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        TextField(value, { value = it }, Modifier.fillMaxWidth(), minLines = 3, style = Type.callout)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4, androidx.compose.ui.Alignment.End)) {
            Button("Cancel", onCancel, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            Button(if (saving) "Saving…" else "Save", { saving = true; onSave(value) { saving = false } }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = !saving)
        }
    }
}

private fun saveBlock(hub: Hub, path: String, text: String, b: DocBlock, value: String, done: (Boolean) -> Unit) {
    val next = replaceBlock(text, b, value)
    if (next == null) { hub.notice.value = "The file changed while you edited. Copy your text and try again."; done(false); return }
    if (next == text) { done(true); return }
    hub.viewModelScope.launch {
        val err = hub.saveFile(path, next)
        if (err != null) hub.notice.value = "Not saved: $err"
        done(err == null)
    }
}

@Composable
fun DocAskSheet(hub: Hub, path: String, state: DocEditState) {
    val b = state.asking ?: return
    var ask by remember(b) { mutableStateOf("") }
    val close = { state.asking = null }
    Sheet(close, "Ask Claude", full = false) {
        Column(Modifier.imePadding().padding(vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
            Text(b.raw.trim(), style = Type.footnote, color = av.fgMuted, maxLines = 4, overflow = TextOverflow.Ellipsis)
            TextField(ask, { ask = it }, Modifier.fillMaxWidth(), placeholder = "What should change?", minLines = 2)
            Button("Send", { hub.askChat(docAskPrompt(path, b.raw, ask)); close() }, variant = ButtonVariant.Filled, enabled = ask.isNotBlank())
        }
    }
}

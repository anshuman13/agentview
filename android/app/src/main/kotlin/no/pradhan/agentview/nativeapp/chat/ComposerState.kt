package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.runInTerminal
import no.pradhan.agentview.nativeapp.app.submit
import no.pradhan.agentview.nativeapp.workspace.withElements

internal class ComposerState(val hub: Hub, val chatId: String) {
    private val draft = splitMarks(hub.draft(chatId))
    var text by mutableStateOf(TextFieldValue(draft.body, TextRange(draft.body.length)))
    var marks by mutableStateOf(draft.marks)

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

    private fun restore(sent: String) {
        val back = splitMarks(restoreUnsent(full, sent))
        marks = back.marks
        text = TextFieldValue(back.body, TextRange(back.body.length))
        hub.setDraft(chatId, full)
    }

    fun submit(steer: Boolean, uploading: Int, voice: Boolean = false) {
        val els = hub.elements.value
        val t = if (els.isEmpty() || shellCommand(full) != null) full else withElements(full, els)
        if (t.isBlank() || uploading > 0) return
        shellCommand(t)?.let { if (hub.runInTerminal(it)) clear(); return }
        clear()
        hub.elements.value = emptyList()
        hub.submit(t, steer, t, voice) { restore(t) }
    }
}

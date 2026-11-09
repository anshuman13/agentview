package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.Undoable
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.saveFile
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.parseFile
import no.pradhan.agentview.nativeapp.workspace.rememberLoad

@Serializable
data class MemoryFile(val path: String, val name: String, val description: String = "", val text: String = "")

// Where a memory file comes from: the repo, or the account folder (.claude, .claude-alt, .codex) it was read from.
fun memoryWhere(f: MemoryFile, cwd: String): String {
    if (f.path.substringBeforeLast('/') == cwd) return "Repo instructions"
    val account = f.path.split('/').lastOrNull { it.startsWith(".claude") || it == ".codex" } ?: ""
    return if (f.path.contains("/memory/")) "Memory · $account" else "Global instructions · $account"
}

// The repo CLAUDE.md with one more bullet; null when the rule is empty. Same as shared/steering.ts.
fun appendRule(text: String, rule: String): String? {
    val line = rule.trim().replace(Regex("\\s+"), " ")
    if (line.isEmpty()) return null
    val head = if (text.isNotEmpty() && !text.endsWith("\n")) "$text\n" else text
    return "$head- $line\n"
}

// Rules go to the first instruction file, the repo's, as a path in the folder; web Memory.tsx ruleFile says the same.
fun ruleFile(cwd: String, files: List<String>): String = files.firstOrNull()?.takeIf { it.startsWith("$cwd/") }?.removePrefix("$cwd/") ?: "CLAUDE.md"

private const val RULE_FAILED = "Could not save the rule. Your text is still here."

@Composable
private fun AddRule(hub: Hub, file: String, onSaved: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val save = { before: String ->
        appendRule(before, text)?.let { next ->
            hub.saveFile(file, next, RULE_FAILED) {
                if (it) {
                    text = ""
                    hub.undoable.tryEmit(Undoable("Rule added") { hub.saveFile(file, before, "Could not undo the rule") { onSaved() } })
                    onSaved()
                }
            }
        }
    }
    val add = {
        if (appendRule("", text) != null) scope.launch {
            runCatching { parseFile(hub.read("/api/file?path=$file")).content }.onSuccess { save(it) }.onFailure { hub.notice.value = RULE_FAILED }
        }
    }
    TextField(text, { text = it }, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), singleLine = true, placeholder = "Add a rule",
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }))
}

// What the agent is told and remembers in this folder, like Windsurf's memories panel. Only the repo instruction file can be changed.
@Composable
fun MemorySheet(hub: Hub, cwd: String, instructionFiles: List<String>, onDismiss: () -> Unit) {
    val file = ruleFile(cwd, instructionFiles)
    val (files, reload) = rememberLoad(cwd) { protocolJson.decodeFromString<List<MemoryFile>>(hub.read("/api/memory")) }
    var open by remember { mutableStateOf<MemoryFile?>(null) }
    open?.let { f ->
        var draft by remember(f) { mutableStateOf<String?>(null) }
        Sheet(onDismiss = onDismiss, title = f.name, action = { Button("Back", { open = null }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) {
            val text = draft
            if (text != null) {
                TextField(text, { draft = it }, minLines = 6)
                Row(Modifier.padding(top = Tokens.sp3), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
                    Button("Save", { hub.saveFile(file, text) { if (it) { open = f.copy(text = text); reload() } } }, size = ButtonSize.Sm)
                    Button("Cancel", { draft = null }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                }
            } else {
                if (f.path == "$cwd/$file") Button("Edit", { draft = f.text }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                Markdown(f.text.ifBlank { "Empty" })
            }
        }
        return
    }
    Sheet(onDismiss = onDismiss, title = "Memory", padded = false, full = false) {
        val list = files.data
        when {
            list == null && files.busy -> EmptyState("Loading memory…")
            list.isNullOrEmpty() -> EmptyState("No memory", files.error.ifEmpty { "No $file or memory files for this folder." })
            else -> list.forEach { f ->
                ListRow(f.name, listOf(f.description, memoryWhere(f, cwd)).filter { it.isNotEmpty() }.joinToString(" · "), lines = 2, trailing = { AvIcon("chevron-right", tint = av.fgMuted) }, onClick = { open = f })
            }
        }
        if (list != null) AddRule(hub, file, reload)
    }
}

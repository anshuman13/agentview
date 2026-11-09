package no.pradhan.agentview.nativeapp

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.serialization.Serializable

@Serializable
data class MemoryFile(val path: String, val name: String, val description: String = "", val text: String = "")

// Where a memory file comes from: the repo, or the account folder (.claude, .claude-alt) it was read from.
fun memoryWhere(f: MemoryFile, cwd: String): String {
    if (f.path == "$cwd/CLAUDE.md") return "Repo instructions"
    val account = f.path.split('/').lastOrNull { it.startsWith(".claude") } ?: ""
    return if (f.path.contains("/memory/")) "Memory · $account" else "Global instructions · $account"
}

// What Claude is told and remembers in this folder, like Windsurf's memories panel. Read-only.
@Composable
fun MemorySheet(hub: Hub, cwd: String, onDismiss: () -> Unit) {
    val (files) = rememberLoad(cwd) { protocolJson.decodeFromString<List<MemoryFile>>(hub.read("/api/memory")) }
    var open by remember { mutableStateOf<MemoryFile?>(null) }
    open?.let { f ->
        Sheet(onDismiss = onDismiss, title = f.name, action = { Button("Back", { open = null }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) {
            Markdown(f.text.ifBlank { "Empty" })
        }
        return
    }
    Sheet(onDismiss = onDismiss, title = "Memory", padded = false, full = false) {
        val list = files.data
        when {
            list == null && files.busy -> EmptyState("Loading memory…")
            list.isNullOrEmpty() -> EmptyState("No memory", files.error.ifEmpty { "No CLAUDE.md or memory files for this folder." })
            else -> list.forEach { f ->
                ListRow(f.name, listOf(f.description, memoryWhere(f, cwd)).filter { it.isNotEmpty() }.joinToString(" · "), lines = 2, trailing = { AvIcon("chevron-right", tint = av.fgMuted) }, onClick = { open = f })
            }
        }
    }
}

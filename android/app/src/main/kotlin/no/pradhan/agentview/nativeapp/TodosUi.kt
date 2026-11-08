package no.pradhan.agentview.nativeapp

import androidx.compose.runtime.Composable
import kotlinx.serialization.Serializable

@Serializable
data class Todo(val path: String, val line: Int, val text: String = "")

@Serializable
data class Todos(val todos: List<Todo> = emptyList())

fun todoPrompt(t: Todo) = "Resolve the TODO at ${t.path}:${t.line}" + (if (t.text.isNotEmpty()) " (\"${t.text}\")" else "") + ". Read the code around it, make the change, remove the comment and tell me what you did."

// TODO and FIXME comments in the repo as ready-made tasks; a tap puts a prompt for one in the composer.
@Composable
fun TodosSheet(hub: Hub, cwd: String, onDismiss: () -> Unit) {
    val (todos) = rememberLoad(cwd) { protocolJson.decodeFromString<Todos>(hub.read("/api/git/todos")).todos }
    Sheet(onDismiss = onDismiss, title = "TODOs", padded = false, full = false) {
        val list = todos.data
        when {
            list == null && todos.busy -> EmptyState("Looking for TODOs")
            list.isNullOrEmpty() -> EmptyState("No TODOs", todos.error.ifEmpty { "No TODO or FIXME comments in tracked files." })
            else -> list.forEach { t ->
                ListRow(t.text.ifEmpty { "TODO" }, "${t.path}:${t.line}", trailing = { AvIcon("edit", tint = av.fgMuted) }, onClick = {
                    hub.draftPrompt(todoPrompt(t))
                    onDismiss()
                })
            }
        }
    }
}

package no.pradhan.agentview.nativeapp

import androidx.compose.runtime.Composable
import kotlinx.serialization.Serializable

@Serializable
data class Todo(val path: String, val line: Int, val text: String = "", val ai: String? = null)

@Serializable
data class Todos(val todos: List<Todo> = emptyList())

fun todoPrompt(t: Todo) = when (t.ai) {
    "!" -> "Do what the AI! comment at ${t.path}:${t.line} asks (\"${t.text}\"). Read the code around it and any other AI comments in the repo, make the change, remove the comment and tell me what you did."
    "?" -> "Answer the AI? comment at ${t.path}:${t.line} (\"${t.text}\"). Read the code around it and change nothing."
    else -> "Resolve the TODO at ${t.path}:${t.line}" + (if (t.text.isNotEmpty()) " (\"${t.text}\")" else "") + ". Read the code around it, make the change, remove the comment and tell me what you did."
}

fun todoTitle(t: Todo) = t.text.ifEmpty { "TODO" }.let { if (t.ai != null) "AI${t.ai} $it" else it }

// AI!/AI? (Aider), to-do and fix-me comments in the repo as ready-made tasks; a tap puts a prompt for one in the composer.
@Composable
fun TodosSheet(hub: Hub, cwd: String, onDismiss: () -> Unit) {
    val (todos) = rememberLoad(cwd) { protocolJson.decodeFromString<Todos>(hub.read("/api/git/todos")).todos }
    Sheet(onDismiss = onDismiss, title = "TODOs", padded = false, full = false) {
        val list = todos.data
        when {
            list == null && todos.busy -> EmptyState("Looking for TODOs")
            list.isNullOrEmpty() -> EmptyState("No TODOs", todos.error.ifEmpty { "No TODO, FIXME or AI! comments in tracked files." })
            else -> list.forEach { t ->
                ListRow(todoTitle(t), "${t.path}:${t.line}", trailing = { AvIcon("edit", tint = av.fgMuted) }, onClick = {
                    hub.draftPrompt(todoPrompt(t))
                    onDismiss()
                })
            }
        }
    }
}

package no.pradhan.agentview.nativeapp

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

class RepoChoice(val key: String?, val name: String)

// The sheet behind the new chat buttons: the repo when none is fixed (the open chat's repo first), and the model, which starts on the last one used.
@Composable
fun NewChatSheet(hub: Hub, repoKey: String?, repos: List<RepoChoice>, onDismiss: () -> Unit, initial: String? = null) {
    val models by hub.models.collectAsState()
    var repo by remember { mutableStateOf(repoKey ?: initial) }
    var model by remember(models) { mutableStateOf(startModel(models, hub.lastModel)) }
    val start = {
        model?.let { hub.lastModel = it }
        hub.newChat(repo, model.takeIf { it != models.firstOrNull()?.value })
        onDismiss()
    }
    Sheet(onDismiss, "New chat", padded = false, full = false, action = { Button("Start", start, variant = ButtonVariant.Filled, size = ButtonSize.Sm) }) {
        if (repoKey == null && repos.isNotEmpty()) {
            SectionHeader("Repo")
            Group {
                repos.forEachIndexed { i, r ->
                    if (i > 0) Hairline()
                    ListRow(r.name, onClick = { repo = r.key }, trailing = if (r.key == repo) { { AvIcon("check", "Selected", Tokens.icon, tint = av.accentText) } } else null)
                }
            }
        }
        if (models.isNotEmpty()) {
            SectionHeader("Model")
            Group {
                models.forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    ListRow(m.displayName.ifBlank { m.value }, m.description, onClick = { model = m.value }, trailing = if (m.value == model) { { AvIcon("check", "Selected", Tokens.icon, tint = av.accentText) } } else null)
                }
            }
        }
    }
}

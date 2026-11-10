package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import no.pradhan.agentview.nativeapp.codex.meetings.displayName
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.lastModel
import no.pradhan.agentview.nativeapp.net.modelsOf
import no.pradhan.agentview.nativeapp.net.ProviderOption
import no.pradhan.agentview.nativeapp.net.newChat
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av

class RepoChoice(val key: String?, val name: String)

// The sheet behind the new chat buttons: the repo when none is fixed (the open chat's repo first), and the model, which starts on the last one used.
@Composable
fun NewChatSheet(hub: Hub, repoKey: String?, repos: List<RepoChoice>, onDismiss: () -> Unit, initial: String? = null) {
    val providers by hub.providers.collectAsState()
    val default by hub.defaultProvider.collectAsState()
    var picked by remember { mutableStateOf<ProviderOption?>(null) }
    val provider = picked ?: providers.firstOrNull { it.id == default && it.enabled } ?: providers.firstOrNull { it.enabled }
    val group = modelGroup(provider?.id ?: default)
    val models by hub.modelsOf(group).collectAsState()
    var repo by remember { mutableStateOf(repoKey ?: initial) }
    var model by remember(models, group) { mutableStateOf(startModel(models, hub.lastModel(group))) }
    var startMode by remember { mutableStateOf(START_MODES.first()) }
    val start = {
        hub.newChat(repo, model, mode = startModeFor(startMode.mode, provider?.id ?: default), draft = startMode.draft, provider = provider?.id)
        onDismiss()
    }
    Sheet(onDismiss, "New chat", padded = false, full = false, action = { Button("Start", start, variant = ButtonVariant.Filled, size = ButtonSize.Sm) }) {
        SectionHeader("Start as")
        Group {
            START_MODES.forEachIndexed { i, m ->
                if (i > 0) Hairline()
                ListRow(m.label, onClick = { startMode = m }, trailing = if (m == startMode) { { AvIcon("check", "Selected", Tokens.icon, tint = av.accentText) } } else null)
            }
        }
        if (providers.size > 1) {
            SectionHeader("Provider")
            Group {
                providers.forEachIndexed { i, p ->
                    if (i > 0) Hairline()
                    ListRow(p.label, if (p.enabled) null else p.note, onClick = if (p.enabled) { { picked = p } } else null, trailing = if (p.id == provider?.id) { { AvIcon("check", "Selected", Tokens.icon, tint = av.accentText) } } else null)
                }
            }
        }
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

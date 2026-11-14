package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.codex.meetings.displayName
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.lastModel
import no.pradhan.agentview.nativeapp.app.modelsOf
import no.pradhan.agentview.nativeapp.net.ProviderOption
import no.pradhan.agentview.nativeapp.app.newChat
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ChoiceRow
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
    val group = modelGroup(provider?.id ?: default, providers)
    val models by hub.modelsOf(group).collectAsState()
    var repo by remember { mutableStateOf(repoKey ?: initial) }
    var model by remember(models, group) { mutableStateOf(startModel(models, hub.lastModel(group))) }
    var startMode by remember { mutableStateOf(START_MODES.first()) }
    val start = {
        hub.newChat(repo, model, mode = startModeFor(startMode.mode, provider?.id ?: default), draft = startMode.draft, provider = provider?.id)
        onDismiss()
    }
    Sheet(onDismiss, "New chat", padded = false, full = false, action = { Button("Start", start, Modifier.padding(end = Tokens.sp5), variant = ButtonVariant.Filled, size = ButtonSize.Sm) }) {
        SectionHeader("Start as")
        Group {
            START_MODES.forEachIndexed { i, m ->
                if (i > 0) Hairline()
                ChoiceRow(m.label, onClick = { startMode = m }, checked = m == startMode)
            }
        }
        if (providers.size > 1) {
            SectionHeader("Provider")
            Group {
                providers.forEachIndexed { i, p ->
                    if (i > 0) Hairline()
                    ChoiceRow(p.label, if (p.enabled) null else p.note, onClick = if (p.enabled) { { picked = p } } else null, checked = p.id == provider?.id)
                }
            }
        }
        if (repoKey == null && repos.isNotEmpty()) {
            SectionHeader("Repo")
            Group {
                repos.forEachIndexed { i, r ->
                    if (i > 0) Hairline()
                    ChoiceRow(r.name, onClick = { repo = r.key }, checked = r.key == repo)
                }
            }
        }
        if (models.isNotEmpty()) {
            SectionHeader("Model")
            Group {
                models.forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    ChoiceRow(m.displayName.ifBlank { m.value }, m.description, onClick = { model = m.value }, checked = m.value == model)
                }
            }
        }
    }
}

package no.pradhan.agentview.nativeapp.ops

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.workspace.pageRepo
import no.pradhan.agentview.nativeapp.ui.select

// The one action of a setup empty state (web ops/SetupButton.tsx): asks the chat on screen to do the setup.
@Composable
fun SetupButton(hub: Hub, kind: String, repo: String = pageRepo(hub), mcpCommand: String = "") {
    val provider by hub.store.state.select { it.session?.provider }
    Button("Set up with ${providerLabel(provider)}", { hub.askChat(setupPrompt(kind, repo, mcpCommand)) }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = !hub.readOnly)
}

package no.pradhan.agentview.nativeapp.ops

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.workspace.pageFolder

// The one action of a setup empty state (web ops/SetupButton.tsx): asks the chat on screen to do the setup.
@Composable
fun SetupButton(hub: Hub, kind: String, repo: String = pageFolder(hub), mcpCommand: String = "") {
    val st by hub.store.state.collectAsState()
    Button("Set up with ${providerLabel(st.session?.provider)}", { hub.askChat(setupPrompt(kind, repo, mcpCommand)) }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = !hub.readOnly)
}

package no.pradhan.agentview.nativeapp.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.saveOrigin
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.FieldLabel
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens

@Composable
fun OriginScreen(hub: Hub, onDone: () -> Unit) {
    val origin by hub.origin.collectAsState()
    var text by remember { mutableStateOf(origin) }
    PageHeader("Mac address", onBack = onDone)
    Column(Modifier.padding(Tokens.listPad), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
        FieldLabel("Server origin")
        TextField(text, { text = it }, singleLine = true)
        Button("Save and reconnect", { hub.saveOrigin(text); onDone() }, variant = ButtonVariant.Filled, fill = true)
    }
}

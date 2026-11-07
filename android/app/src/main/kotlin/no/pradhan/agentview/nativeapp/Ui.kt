package no.pradhan.agentview.nativeapp

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

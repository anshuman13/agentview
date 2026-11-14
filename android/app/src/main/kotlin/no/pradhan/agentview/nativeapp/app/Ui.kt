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

import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.FieldLabel
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.rememberLoad

@Composable
fun OriginScreen(hub: Hub, onDone: () -> Unit) {
    val origin by hub.origin.collectAsState()
    var text by remember { mutableStateOf(origin) }
    val (macs) = rememberLoad(origin) { hub.macs(origin) }
    PageHeader("Mac address", onBack = onDone)
    macs.data?.let { list ->
        SectionHeader("Macs")
        list.forEach { m ->
            val meta = listOfNotNull("In use".takeIf { m.current }, "${m.running} working".takeIf { m.running > 0 }).joinToString(" · ").ifEmpty { null }
            ListRow(m.name, meta, selected = m.current, onClick = { if (!m.current) hub.saveOrigin(m.url); onDone() })
        }
    }
    Column(Modifier.padding(Tokens.listPad), verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
        FieldLabel("Server origin")
        TextField(text, { text = it }, singleLine = true)
        Button("Save and reconnect", { hub.saveOrigin(text); onDone() }, variant = ButtonVariant.Filled, fill = true)
    }
}

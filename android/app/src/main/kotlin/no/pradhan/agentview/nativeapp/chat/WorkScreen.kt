package no.pradhan.agentview.nativeapp.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.select

// One turn's tool calls and Claude's text between them, in the order they ran (web WorkPane.tsx). Opened from the tools button of a turn.
@Composable
fun WorkScreen(hub: Hub, turn: String, onBack: () -> Unit, onOpenAgent: (String) -> Unit) {
    BackHandler(onBack = onBack)
    val view by hub.transcript.view.collectAsState()
    val cwd by hub.store.state.select { it.session?.cwd ?: "" }
    val chat by hub.store.state.select { it.shownId }
    val running by hub.store.state.select { it.session?.running ?: false }
    val hidden = remember(view, turn) { view.foldRows.firstNotNullOfOrNull { (it as? FoldRow.Fold)?.takeIf { f -> f.id == turn } }?.hidden ?: emptyList() }
    val prompt = remember(view, turn) { (view.items.firstOrNull { it.id == turn } as? Item.User)?.text?.let(::firstLine) ?: "" }
    Column(Modifier.fillMaxSize()) {
        PageHeader("Tool calls", onBack, subtitle = if (prompt.isEmpty()) null else { { Text(prompt, maxLines = 1) } })
        if (hidden.isEmpty()) {
            EmptyState("No tool calls", "This turn is not in the loaded chat, or it ran no tools", icon = "list-tree")
            return
        }
        LazyColumn(Modifier.fillMaxSize()) {
            items(hidden, key = { it.id }) { s -> Box(Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp1)) { ItemRow(hub, s, chat, cwd, !running, onOpenAgent) } }
            item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
        }
    }
}

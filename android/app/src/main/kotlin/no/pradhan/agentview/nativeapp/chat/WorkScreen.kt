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
import androidx.compose.ui.text.font.FontWeight
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.select

// One turn's tool calls and Claude's text between them, in the order they ran (web WorkPane.tsx). Opened from the tools button of a turn.
@Composable
fun WorkScreen(hub: Hub, turn: String, onBack: () -> Unit, onOpenAgent: (String) -> Unit) {
    BackHandler(onBack = onBack)
    val view by hub.transcript.view.collectAsState()
    val cwd by hub.store.state.select { it.session?.cwd ?: "" }
    val chat by hub.store.state.select { it.shownId }
    val running by hub.store.state.select { it.session?.running ?: false }
    val mine = view.chat == chat
    val hidden = remember(view.foldRows, turn, mine) { if (!mine) emptyList() else view.foldRows.firstNotNullOfOrNull { (it as? FoldRow.Fold)?.takeIf { f -> f.id == turn } }?.hidden ?: emptyList() }
    val prompt = remember(view.items, turn) { (view.items.firstOrNull { it.id == turn } as? Item.User)?.text?.let(::firstLine) ?: "" }
    val waiting by hub.store.state.select { it.pending.isNotEmpty() }
    val last = remember(view.items, turn) { view.items.lastOrNull { it is Item.User }?.id == turn }
    val (word, tone) = when {
        last && waiting -> "Needs input" to av.warn
        last && running -> "Working" to av.accentText
        else -> "Done" to av.ok
    }
    Column(Modifier.fillMaxSize()) {
        PageHeader(prompt.ifEmpty { "Tool calls" }, onBack, subtitle = { Text(word, color = tone, fontWeight = FontWeight.SemiBold, maxLines = 1) })
        Text(if (word == "Done") "What Claude did" else "What Claude is doing", style = Type.label, color = av.fgMuted, modifier = Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4))
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

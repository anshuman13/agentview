package no.pradhan.agentview.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatList(hub: Hub, onOpen: (String) -> Unit) {
    val state by hub.store.state.collectAsState()
    val connected by hub.connected.collectAsState()
    TopAppBar(title = { Text("Sessions") })
    val chats = state.live.sortedByDescending { it.lastActive }
    if (chats.isEmpty()) {
        Text(if (connected) "No live chats" else "Waiting for the server. Check the Mac address.", Modifier.padding(16.dp))
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(chats, key = { it.id }) { c ->
            ListItem(
                modifier = Modifier.clickable { onOpen(c.id) },
                overlineContent = { Text(listOfNotNull(if (c.running) "Running" else c.status.ifBlank { "Idle" }, if (c.pending > 0) "${c.pending} waiting" else null, c.cwd.substringAfterLast('/')).joinToString(" - ")) },
                headlineContent = { Text(c.title.ifBlank { "Untitled" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                supportingContent = c.last?.takeIf { it.isNotBlank() }?.let { { Text(it.trim().lines().first(), maxLines = 2, overflow = TextOverflow.Ellipsis) } },
            )
            HorizontalDivider()
        }
    }
}

private val shown = setOf("user", "assistant", "tool_use", "agent")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(hub: Hub) {
    val state by hub.store.state.collectAsState()
    val chat = state.live.firstOrNull { it.id == state.shownId }
    TopAppBar(title = { Text(chat?.title?.ifBlank { null } ?: "Chat", maxLines = 1, overflow = TextOverflow.Ellipsis) })
    if (chat == null) {
        Text("Open a chat from Sessions.", Modifier.padding(Sp.s8), color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val rows = remember(state.events) { state.events.filter { it.kind in shown }.asReversed() }
    Column(Modifier.fillMaxSize().imePadding()) {
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), reverseLayout = true, verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
            items(rows, key = { it.id }) { EventRow(it) }
        }
        Composer(running = chat?.running == true, onSend = hub::send)
    }
}

@Composable
private fun EventRow(e: ChatEvent) {
    when (e.kind) {
        "user" -> Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer), modifier = Modifier.fillMaxWidth().padding(start = 40.dp)) {
            Text(e.text, Modifier.padding(10.dp), style = MaterialTheme.typography.bodyMedium)
        }
        "assistant" -> Markdown(e.text + if (e.streaming) " ▍" else "", Modifier.fillMaxWidth())
        else -> {
            var open by remember { mutableStateOf(false) }
            val line = if (e.kind == "agent") "Agent: ${e.description}" else "${e.name} ${e.summary}".trim()
            Text(
                line,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (open) Int.MAX_VALUE else 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().clickable { open = !open },
            )
        }
    }
}

@Composable
private fun Composer(running: Boolean, onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = androidx.compose.ui.Alignment.Bottom) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.weight(1f),
            placeholder = { Text(if (running) "Queue for Claude's next step" else "Message") },
            maxLines = 5,
            shape = RoundedCornerShape(20.dp),
        )
        IconButton(onClick = { onSend(text); text = "" }, enabled = text.isNotBlank()) { Icon(Icons.AutoMirrored.Filled.Send, "Send") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OriginScreen(hub: Hub, onDone: () -> Unit) {
    val origin by hub.origin.collectAsState()
    var text by remember { mutableStateOf(origin) }
    TopAppBar(
        title = { Text("Mac address") },
        navigationIcon = { IconButton(onClick = onDone) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
    )
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(value = text, onValueChange = { text = it }, label = { Text("Server origin") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        TextButton(onClick = { hub.saveOrigin(text); onDone() }) { Text("Save and reconnect") }
    }
}

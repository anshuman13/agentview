package no.pradhan.agentview.nativeapp

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import kotlinx.coroutines.delay

// The Agents tab (web/src/sessions/AgentsPane.tsx): the sub-agents of the chat on screen, and one agent's report, prompt and steps.
@Composable
fun AgentsScreen(hub: Hub) {
    val st by hub.store.state.collectAsState()
    val agents = remember(st.events) { buildAgents(st.events) }
    val running = agents.any { it.status == "running" }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(running) { while (running) { now = System.currentTimeMillis(); delay(1000) } }
    var sel by rememberSaveable(st.shownId) { mutableStateOf<String?>(null) }
    val current = agents.firstOrNull { it.id == sel }
    if (current != null) { AgentPage(hub, current, st.session?.cwd ?: "", st.shownId, now) { sel = null }; return }
    val title = st.live.firstOrNull { it.id == st.shownId }?.title

    Column(Modifier.fillMaxSize()) {
        PageHeader("Agents", subtitle = title?.let { { WordClamp(androidx.compose.ui.text.AnnotatedString(it), Type.footnote, av.fgMuted, 2) } })
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                when {
                    st.shownId.isEmpty() -> item { EmptyState("No chat open", "Open a chat to see the sub-agents Claude starts in it", small = false) }
                    agents.isEmpty() -> item { EmptyState("No agents yet", "Sub-agents Claude starts in this chat show up here, with their prompt, steps and report", small = false) }
                    else -> {
                        for ((name, rows) in agentGroups(agents)) {
                            item(key = "h:${name ?: ""}") { SectionHeader(name ?: "Agents", rows.size.toString()) }
                            item(key = "g:${name ?: ""}") {
                                Group {
                                    rows.forEachIndexed { i, a ->
                                        if (i > 0) Hairline(lead = true)
                                        ListRow(a.description, agentRowMeta(a), leading = { StatusDot(agentDot(a.status)) }, trailing = { RowLabel(agentTrailing(a, now)) }, onClick = { sel = a.id })
                                    }
                                }
                            }
                        }
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}

@Composable
private fun AgentPage(hub: Hub, a: Agent, cwd: String, chat: String, now: Long, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val running = a.status == "running"
    var prompt by rememberSaveable(a.id) { mutableStateOf(false) }
    val clip = LocalClipboardManager.current
    Column(Modifier.fillMaxSize()) {
        PageHeader(a.description, onBack, subtitle = { Text(agentMeta(a, now), style = Type.footnote, color = av.fgMuted, maxLines = 2) }) {
            if (running && a.group == null) Button("Stop", { hub.stopTask(a.id) }, size = ButtonSize.Sm)
        }
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = Tokens.listPad), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            if (running) {
                a.info?.progress?.let { item { Text(it, style = Type.subheadline, color = av.fg) } }
                item { Text("Last activity ${elapsed(now - a.lastAt)} ago" + if (a.lastStep.isNotEmpty()) " · ${a.lastStep}" else "", style = Type.footnote, color = av.fgMuted) }
                item { Text("The report shows here when the agent finishes.", style = Type.footnote, color = av.fgMuted) }
            } else {
                item { Markdown(reportText(a), Modifier.padding(vertical = Tokens.sp4)) }
                item { Button("Copy report", { clip.setText(AnnotatedString(reportText(a))) }, size = ButtonSize.Sm) }
            }
            if (a.prompt.isNotEmpty()) {
                item { SectionHeader("Prompt", open = prompt, onToggle = { prompt = !prompt }) }
                if (prompt) item { Markdown(a.prompt) }
            }
            item { SectionHeader("Steps", a.item.steps.size.toString()) }
            if (a.item.steps.isEmpty()) item { EmptyState("No steps yet") }
            items(a.item.steps, key = { it.id }) { s -> ItemRow(hub, s, chat, cwd, !running) }
            item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
        }
    }
}

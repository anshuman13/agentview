package no.pradhan.agentview.nativeapp.ops

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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import no.pradhan.agentview.nativeapp.chat.ItemRow
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.stopTask
import no.pradhan.agentview.nativeapp.sessions.state
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.RowLabel
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.color
import no.pradhan.agentview.nativeapp.ui.rememberNow
import no.pradhan.agentview.nativeapp.ui.select

// One agent's report, prompt and steps (web/src/sessions/AgentsPane.tsx), and the list of the chat's sub-agents shown in the Chat sheet. Not a tab.
@Composable
fun AgentScreen(hub: Hub, id: String, onBack: () -> Unit, onOpenAgent: (String) -> Unit) {
    val view by hub.transcript.view.collectAsState()
    val cwd by hub.store.state.select { it.session?.cwd ?: "" }
    val shownId by hub.store.state.select { it.shownId }
    val agent = remember(view, id) { view.agents.firstOrNull { it.id == id } }
    if (agent != null) { AgentPage(hub, agent, cwd, shownId, onBack, onOpenAgent); return }
    Column(Modifier.fillMaxSize()) {
        PageHeader("Agent", onBack)
        EmptyState("Agent not found", "It is not in the chat on screen")
    }
}

@Composable
fun AgentList(agents: List<Agent>, now: () -> Long, onOpen: (String) -> Unit) {
    for ((name, rows) in agentGroups(agents)) {
        SectionHeader(name ?: "Agents", rows.size.toString())
        Group {
            rows.forEachIndexed { i, a ->
                if (i > 0) Hairline(lead = true)
                ListRow(a.description, agentRowMeta(a), leading = { StatusDot(agentDot(a.status)) }, trailing = { RowLabel(agentTrailing(a, now())) }, onClick = { onOpen(a.id) })
            }
        }
    }
}

@Composable
private fun AgentPage(hub: Hub, a: Agent, cwd: String, chat: String, onBack: () -> Unit, onOpenAgent: (String) -> Unit) {
    BackHandler(onBack = onBack)
    val running = a.status == "running"
    val now by rememberNow(running)
    var prompt by rememberSaveable(a.id) { mutableStateOf(false) }
    val clip = LocalClipboardManager.current
    Column(Modifier.fillMaxSize()) {
        PageHeader(a.description, onBack, subtitle = { Text(agentMeta(a, now), maxLines = 1) }) {
            if (running && a.group == null) Button("Stop", { hub.stopTask(a.id) }, Modifier.padding(end = Tokens.sp6), variant = ButtonVariant.Danger, size = ButtonSize.Sm)
        }
        val pad = Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2)
        LazyColumn(Modifier.fillMaxSize()) {
            if (running) {
                a.info?.progress?.let { item { Text(it, pad, style = Type.subheadline, color = av.fg) } }
                item { Text("Last activity ${elapsed(now - a.lastAt)} ago" + if (a.lastStep.isNotEmpty()) " · ${a.lastStep}" else "", pad, style = Type.footnote, color = av.fgMuted) }
                item { Text("The report shows here when the agent finishes.", pad, style = Type.footnote, color = av.fgMuted) }
            } else {
                item { Markdown(reportText(a), pad) }
                item { Box(pad) { Button("Copy report", { clip.setText(AnnotatedString(reportText(a))) }, size = ButtonSize.Sm) } }
            }
            if (a.prompt.isNotEmpty()) {
                item { SectionHeader("Prompt", open = prompt, onToggle = { prompt = !prompt }) }
                if (prompt) item { Markdown(a.prompt, pad) }
            }
            item { SectionHeader("Steps", a.item.steps.size.toString()) }
            if (a.item.steps.isEmpty()) item { Box(pad) { EmptyState("No steps yet") } }
            items(a.item.steps, key = { it.id }) { s -> Box(Modifier.padding(horizontal = Tokens.listPad)) { ItemRow(hub, s, chat, cwd, !running, onOpenAgent) } }
            item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
        }
    }
}

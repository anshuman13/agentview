package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.AnnotatedString
import no.pradhan.agentview.nativeapp.codex.autopilot.loopNow
import no.pradhan.agentview.nativeapp.codex.autopilot.RunActions
import no.pradhan.agentview.nativeapp.codex.autopilot.RunRows
import no.pradhan.agentview.nativeapp.codex.autopilot.runLine
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.ops.Agent
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.app.archive
import no.pradhan.agentview.nativeapp.app.closeChat
import no.pradhan.agentview.nativeapp.app.rename
import no.pradhan.agentview.nativeapp.app.stopTask
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.ui.keepScrollInside
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ops.AgentBody
import no.pradhan.agentview.nativeapp.ops.AgentList
import no.pradhan.agentview.nativeapp.ops.agentMeta
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ops.UnseenAgentList
import no.pradhan.agentview.nativeapp.sessions.renameTitle
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.workspace.FileScreen
import no.pradhan.agentview.nativeapp.ui.TextDialog
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.rememberNow

@Composable
internal fun ChatSheets(hub: Hub, live: LiveChat, session: SessionInfo?, agents: List<Agent>, panels: ChatPanels, cwd: String, onOpenAgent: (String) -> Unit, run: ChatRun?) {
    val clip = LocalClipboardManager.current
    val sessionId = live.sessionId ?: session?.sessionId
    val unseen = remember(live.agentList, agents) { unseenAgents(live.agentList, agents) }
    val now = rememberNow(panels.agents && (unseen.isNotEmpty() || agents.any { it.status == "running" }))
    // One sheet for the list and an open agent, so going back swaps its content without closing it.
    val shown = panels.shownAgent(agents)
    if (panels.agents) Sheet(
        onDismiss = { panels.closeAgents() }, title = shown?.description ?: "Agents", padded = false, full = false,
        onBack = shown?.let { { panels.agent = null } },
        action = { if (shown != null) AgentStop(hub, shown) else AgentsActions(hub, run, agents) },
    ) {
        if (shown != null) {
            Text(agentMeta(shown, now.value), Modifier.fillMaxWidth().padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4), style = Type.footnote, color = av.fgMuted, maxLines = 1)
            Box(Modifier.height(sheetHeight()).keepScrollInside()) {
                AgentBody(hub, shown, cwd, live.id) { id -> if (agents.any { it.id == id }) panels.agent = id else { panels.closeAgents(); onOpenAgent(id) } }
            }
            return@Sheet
        }
        run?.let { r ->
            val line = listOfNotNull(runLine(r), loopNow(r, live.now).next?.let { "next $it" }).joinToString(" · ")
            Text(line, Modifier.fillMaxWidth().padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4), style = Type.footnote, color = av.fgMuted)
            RunRows(hub, r, live)
        }
        AgentList(agents, { now.value }) { panels.agent = it }
        UnseenAgentList(unseen) { now.value }
    }
    if (panels.tools) Sheet(onDismiss = { panels.tools = false }, title = "Tools", padded = false, full = false) {
        val open = { panel: () -> Unit -> { panels.tools = false; panel() } }
        Group {
            ListRow("Memory", "Instruction and memory files", onClick = open { panels.memory = true }, trailing = { Chevron() })
            session?.resumeCommand?.let { command ->
                Hairline()
                ListRow("Continue in terminal", "Copy the command that resumes this chat", onClick = open {
                    clip.setText(AnnotatedString(command))
                    hub.notice.value = "Copied. Stop this chat before resuming it in a terminal"
                }, trailing = { Chevron() })
            }
        }
    }
    if (panels.memory) MemorySheet(hub, cwd, session?.instructionFiles.orEmpty()) { panels.memory = false }
    panels.file?.let { f ->
        val close = { panels.file = null }
        Sheet(close, "File", padded = false) { Box(Modifier.height(sheetHeight()).keepScrollInside()) { FileScreen(hub, f.path, close, line = f.line) } }
    }
    when (panels.dialog) {
        "rename" -> RenameDialog(live.title, onSave = { hub.rename(sessionId!!, it) }, onDismiss = { panels.dialog = null })
        "archive" -> ConfirmDialog("Archive this chat?", "${live.title}\n\nYou can restore it from the bin for 7 days.", "Archive", { hub.archive(sessionId!!) }) { panels.dialog = null }
        "close" -> ConfirmDialog("Close this chat?", "${live.title}\n\nThe agent is still working on it and will stop. The transcript is kept.", "Close", { hub.closeChat(live.id) }) { panels.dialog = null }
    }
}

@Composable
fun RenameDialog(current: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    TextDialog("Rename chat", current, "Save", { t -> renameTitle(t, current)?.let(onSave) }, onDismiss, maxLength = 120)
}

// The Agents sheet's head on the list: the run's controls, else stop every running agent.
@Composable
private fun AgentsActions(hub: Hub, run: ChatRun?, agents: List<Agent>) {
    val running = agents.filter { it.status == "running" && it.group == null }
    if (run != null) RunActions(hub, run)
    else if (running.isNotEmpty()) IconBtn("debug-stop", "Stop all agents", { running.forEach { hub.stopTask(it.id) } }, enabled = !hub.readOnly)
}

@Composable
private fun AgentStop(hub: Hub, a: Agent) {
    val canStop by hub.store.state.select { it.session?.capabilities?.stopTask ?: true }
    if (a.status == "running" && a.group == null && canStop) IconBtn("debug-stop", "Stop this agent", { hub.stopTask(a.id) }, enabled = !hub.readOnly)
}

@Composable
internal fun sheetHeight() = LocalConfiguration.current.screenHeightDp.dp * 0.8f

package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import no.pradhan.agentview.nativeapp.app.loadContextUsage
import no.pradhan.agentview.nativeapp.ui.Type
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import no.pradhan.agentview.nativeapp.net.Capabilities
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.net.menuModes
import no.pradhan.agentview.nativeapp.net.modeSteps
import no.pradhan.agentview.nativeapp.net.newestModels
import no.pradhan.agentview.nativeapp.app.refreshUsage
import no.pradhan.agentview.nativeapp.app.setAccount
import no.pradhan.agentview.nativeapp.app.setEffort
import no.pradhan.agentview.nativeapp.app.setMode
import no.pradhan.agentview.nativeapp.app.setModel
import no.pradhan.agentview.nativeapp.app.setReview
import no.pradhan.agentview.nativeapp.app.submit
import no.pradhan.agentview.nativeapp.app.command
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.ops.mcpToggleCmd
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Toggle
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ChoiceRow
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av

internal class Choice(val value: String, val label: String, val detail: String = "")

internal enum class Picker { Add, Settings, Effort, Account, Context, Connectors }

@Composable
internal fun ComposerSheets(hub: Hub, s: ComposerState, uploading: Int, session: SessionInfo?, sheet: Picker?, attach: Attach, onSheet: (Picker?) -> Unit) {
    when (sheet) {
        Picker.Add -> AddSheet(s, uploading, session, attach, onSheet)
        Picker.Context -> ContextSheet(s, session, onSheet)
        Picker.Connectors -> ConnectorsSheet(hub, session, onSheet)
        Picker.Settings -> ChatSettingsSheet(hub, session, onSheet)
        Picker.Effort -> PickerSheet("Select effort", effortsFor(session?.models.orEmpty(), session?.model).map { Choice(it, EFFORT_LABEL[it] ?: it) }, session?.effort, { hub.setEffort(it) }) { onSheet(null) }
        Picker.Account -> PickerSheet("Select Claude account", (session?.accounts?.ifEmpty { null } ?: listOf(session?.account ?: "main")).map { Choice(it, ACCOUNT_LABEL[it] ?: it, listOfNotNull(ACCOUNT_NOTE[it], usageText(session?.usage).ifEmpty { null }?.takeIf { _ -> it == (session?.account ?: "main") }).joinToString(" · ")) }, session?.account ?: "main", { hub.setAccount(it) }) { onSheet(null) }
        null -> {}
    }
}

@Composable
private fun AddSheet(s: ComposerState, uploading: Int, session: SessionInfo?, attach: Attach, onSheet: (Picker?) -> Unit) {
    val c = av
    val pct = contextPercent(session?.context, session?.contextWindow)
    val icon = { name: String -> @Composable { AvIcon(name, null, Tokens.iconMd, tint = c.fgMuted) } }
    val settings = settingsLabel(modelName(session), session?.effort, session?.capabilities?.effort ?: true, session?.provider, session?.permissionMode ?: "default", session?.review == true)
    Sheet({ onSheet(null) }, "Add", padded = false, full = false) {
        Group {
            ListRow("Photo", leading = icon("file-media"), onClick = { onSheet(null); attach.choosePhoto() })
            Hairline(lead = true)
            ListRow("Take photo", leading = icon("device-camera"), onClick = { onSheet(null); attach.takePhoto() })
            Hairline(lead = true)
            ListRow("Choose file", leading = icon("file"), onClick = { onSheet(null); attach.chooseFile() })
            Hairline(lead = true)
            ListRow("Chat settings", settings, leading = icon("settings-gear"), onClick = { onSheet(Picker.Settings) }, trailing = { Chevron() })
            if (pct != null) {
                Hairline(lead = true)
                ListRow("Context", "$pct% used", leading = icon("pulse"), onClick = { onSheet(Picker.Context) }, trailing = { Chevron() })
            }
            val conns = composerConnectors(session?.mcp.orEmpty())
            if (conns.isNotEmpty() && session?.capabilities?.can("mcp") != false) {
                Hairline(lead = true)
                ListRow("Connectors", "${conns.count { it.on }} on", leading = icon("plug"), onClick = { onSheet(Picker.Connectors) }, trailing = { Chevron() })
            }
        }
    }
}

@Composable
private fun ConnectorsSheet(hub: Hub, session: SessionInfo?, onSheet: (Picker?) -> Unit) {
    val rows = composerConnectors(session?.mcp.orEmpty())
    val canEdit = session?.capabilities?.can("mcpEdit") != false && !hub.readOnly
    val dot = { tone: String -> when (tone) { "ok" -> DotState.Ok; "bad" -> DotState.Bad; "warn" -> DotState.Warn; "wait" -> DotState.Busy; else -> DotState.Faint } }
    Sheet({ onSheet(null) }, "Connectors", padded = false, full = false, onBack = { onSheet(Picker.Add) }) {
        Group {
            rows.forEachIndexed { i, r ->
                if (i > 0) Hairline(lead = true)
                ListRow(r.label, r.note.takeIf { r.on && it.isNotEmpty() }, leading = { StatusDot(dot(r.tone)) }, toggle = Toggle(r.on, canEdit) { on -> hub.command(mcpToggleCmd(r.name, on)) })
            }
        }
        Group {
            ListRow("Manage", leading = { AvIcon("settings-gear", null, Tokens.iconMd, tint = av.fgMuted) }, onClick = { onSheet(null); hub.link.value = DeepLink(page = "mcp") }, trailing = { Chevron() })
        }
    }
}

@Composable
private fun ChatSettingsSheet(hub: Hub, session: SessionInfo?, onSheet: (Picker?) -> Unit) {
    val c = av
    Sheet({ onSheet(null) }, "Chat settings", padded = false, full = false) {
        val account = session?.account ?: "main"
        val caps = session?.capabilities ?: Capabilities()
        val models = session?.models.orEmpty()
        val effort = session?.effort?.takeIf { caps.effort }
        SectionHeader("Run")
        val review = session?.review == true
        val modes = menuModes(session?.provider, session?.permissionMode ?: "default", review)
        Group {
            modes.list.forEachIndexed { i, m ->
                if (i > 0) Hairline()
                ChoiceRow(m.label, m.detail, checked = m.value == modes.checked, onClick = {
                    val (mode, reviewOn) = modeSteps(session?.permissionMode ?: "default", review, m.value)
                    mode?.let { hub.setMode(it) }
                    reviewOn?.let { hub.setReview(it) }
                    onSheet(null)
                })
            }
        }
        if (models.isNotEmpty()) {
            val current = modelRow(models, session?.model)
            var all by remember { mutableStateOf(false) }
            val newest = newestModels(models, current)
            Group {
                (if (all) models else newest).forEachIndexed { i, m ->
                    if (i > 0) Hairline()
                    ChoiceRow(m.displayName.ifBlank { m.value }, m.description, onClick = { hub.setModel(m.value); onSheet(null) }, checked = m.value == current)
                }
                if (!all && newest.size < models.size) {
                    Hairline()
                    ListRow("Older models", "${models.size - newest.size} more", onClick = { all = true }, trailing = { Chevron() })
                }
            }
        }
        val showAccount = (session?.accounts?.size ?: 0) > 1 || account != "main"
        if (showAccount || effort != null) Group {
            effort?.let { ListRow("Effort", EFFORT_LABEL[it] ?: it, onClick = { onSheet(Picker.Effort) }, trailing = { Chevron() }) }
            if (showAccount) { if (effort != null) Hairline(); ListRow("Account", ACCOUNT_LABEL[account] ?: account, onClick = { hub.refreshUsage(); onSheet(Picker.Account) }, trailing = { Chevron() }) }
        }
    }
}

@Composable
private fun PickerSheet(title: String, items: List<Choice>, current: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    Sheet(onDismiss, title, padded = false, full = false) {
        Group {
            items.forEachIndexed { i, c ->
                if (i > 0) Hairline()
                ChoiceRow(c.label, c.detail, checked = c.value == current, onClick = { onPick(c.value); onDismiss() })
            }
        }
    }
}

@Composable
private fun ContextSheet(s: ComposerState, session: SessionInfo?, onSheet: (Picker?) -> Unit) {
    val c = av
    val rowsToo = session?.capabilities?.can("contextUsage") ?: false
    LaunchedEffect(rowsToo) { if (rowsToo) s.hub.loadContextUsage() }
    val panel = contextPanel(if (rowsToo) session?.contextUsage else null, session?.context, session?.contextWindow) ?: return
    val tones = listOf(c.accentFill, c.err, c.ok, c.warn)
    val swatch = { color: Color -> @Composable { Box(Modifier.size(10.dp).background(color, RoundedCornerShape(2.dp))) } }
    Sheet({ onSheet(null) }, "Context", padded = false, full = false, onBack = { onSheet(Picker.Add) }) {
        Group {
            ListRow(panel.used.ifEmpty { panel.amount }, panel.amount.takeIf { panel.used.isNotEmpty() }, below = {
                Box(Modifier.fillMaxWidth().padding(top = Tokens.sp2).height(4.dp).background(c.border, RoundedCornerShape(2.dp))) {
                    Box(Modifier.fillMaxWidth(panel.fill.toFloat()).fillMaxHeight().background(c.accentFill, RoundedCornerShape(2.dp)))
                }
            })
            if (rowsToo && session?.contextUsage == null) { Hairline(); ListRow("Reading the breakdown…", muted = true) }
            panel.rows.forEach { r ->
                Hairline(lead = !r.gap)
                ListRow(r.name, leading = swatch(r.tone?.let { tones.getOrElse(it) { c.fgMuted } } ?: c.border), trailing = { Text("${r.tokens}  ${r.share}", style = Type.body, color = c.fgMuted) }, compact = true)
            }
        }
        val compacting = session?.compacting == true
        val running = session?.running == true
        val idle = !compacting && !running && !s.hub.readOnly
        Group {
            ListRow("Compact now", when { compacting -> "Compacting…"; running -> "Compacts when this turn ends"; else -> null }, muted = !idle, onClick = if (idle) ({ onSheet(null); s.hub.submit("/compact", false) {} }) else null)
        }
    }
}

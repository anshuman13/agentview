package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Chevron
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.openLink

private val ICONS = mapOf("status" to "pulse", "search" to "search", "page" to "globe", "explore" to "list-tree", "agent" to "sparkle", "work" to "tools")

// Web chat/transcript/SummarySheet.tsx: under a finished turn's reply, one row that opens the turn's status lines, searches and pages.
@Composable
internal fun SummaryRow(events: List<ChatEvent>) {
    var open by remember(events.first().id) { mutableStateOf(false) }
    val entries = turnSummary(events)
    val counts = summaryCounts(entries, summarySteps(events))
    Column(Modifier.padding(top = Tokens.sp4).fillMaxWidth().clip(RoundedCornerShape(Tokens.shapeLg)).background(av.groupCard)) {
        ListRow("Summary", counts.joinToString(" \u00B7 "), trailing = { Chevron() }, lines = 1, onClick = { open = true })
    }
    if (open) SummarySheet(entries, counts) { open = false }
}

@Composable
private fun SummarySheet(entries: List<SummaryEntry>, counts: List<String>, onClose: () -> Unit) {
    val open = openLink()
    Sheet(onClose, "Summary", padded = false) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
            counts.forEach { Badge(it, BadgeTone.Quiet) }
        }
        Group {
            entries.forEachIndexed { i, e ->
                if (i > 0) Hairline(lead = true)
                ListRow(
                    e.title, e.meta,
                    leading = { AvIcon(ICONS.getValue(e.kind), null, Tokens.iconSm) },
                    state = if (e.failed) ({ Badge("Failed", BadgeTone.Failed) }) else if (e.running) ({ Badge("Running", BadgeTone.Running) }) else null,
                    trailing = e.url?.takeIf { it.isNotEmpty() }?.let { url -> { IconBtn("link-external", "Open page", { open(url) }) } },
                    lines = 1,
                )
            }
        }
    }
}

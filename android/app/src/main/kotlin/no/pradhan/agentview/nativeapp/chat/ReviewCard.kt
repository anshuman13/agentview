package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.review
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.ReviewFile
import no.pradhan.agentview.nativeapp.net.ReviewHunk
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.DiffLine
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.Panel
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.plural

private val REVIEW_STATE = mapOf("kept" to "Kept", "undone" to "Undone")

@Composable
private fun ReviewActions(keep: String, undo: String?, state: String?, onKeep: () -> Unit, onUndo: () -> Unit) {
    if (state != null) Text(REVIEW_STATE[state] ?: state, style = Type.footnote, color = av.fgMuted)
    else Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        Button(keep, onKeep, variant = ButtonVariant.Filled, size = ButtonSize.Sm)
        if (undo != null) Button(undo, onUndo, variant = ButtonVariant.Gray, size = ButtonSize.Sm)
    }
}

@Composable
private fun ReviewHunkRow(h: ReviewHunk, id: String, file: String, k: Int, hub: Hub) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        Text("Line ${h.line}", style = Type.footnote, color = av.fgMuted)
        DiffView(h.del.map { DiffLine('-', it) } + h.add.map { DiffLine('+', it) })
        ReviewActions("Keep", "Undo", h.state, { hub.review(id, "keep", file, k) }, { hub.review(id, "undo", file, k) })
    }
}

@Composable
private fun ReviewFileRow(f: ReviewFile, id: String, hub: Hub) {
    val undecided = if (f.hunks.isEmpty()) f.state == null else f.hunks.any { it.state == null }
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        Text(f.path, style = Mono, color = av.fg)
        if (f.created || f.binary) Text(if (f.created) "New file" else if (f.large) "Too large to show, see Changes" else "Binary file", style = Type.footnote, color = av.fgMuted)
        if (undecided) ReviewActions("Keep file", if (f.binary) null else "Undo file", null, { hub.review(id, "keep", f.path) }, { hub.review(id, "undo", f.path) })
        else f.state?.let { Text(REVIEW_STATE[it] ?: it, style = Type.footnote, color = av.fgMuted) }
        f.hunks.forEachIndexed { k, h -> ReviewHunkRow(h, id, f.path, k, hub) }
    }
}

@Composable
fun ReviewCard(ev: ChatEvent, hub: Hub) {
    val count = ev.files.sumOf { maxOf(it.hunks.size, 1) }
    Panel {
        if (ev.result.isNotEmpty()) {
            Title("Reviewed ${plural(count, "change")}")
            Desc(ev.result)
        } else {
            Title("Review ${plural(count, "change")}")
            ev.files.forEach { ReviewFileRow(it, ev.id, hub) }
            Primary("Keep all") { hub.review(ev.id, "keep") }
        }
    }
}

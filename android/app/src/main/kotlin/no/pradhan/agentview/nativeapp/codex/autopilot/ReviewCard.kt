package no.pradhan.agentview.nativeapp.codex.autopilot

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.runReview
import no.pradhan.agentview.nativeapp.ops.DiffFiles
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.rememberLoad

private const val SHOWN_FILES = 3

// A paused job run waiting for review (web ReviewCard): the summary, its changed files, then Approve and a menu with Revise, Open chat and Discard.
@Composable
fun ReviewCard(hub: Hub, run: ChatRun, now: Long, onChat: () -> Unit) {
    val scope = rememberCoroutineScope()
    val (load, reload) = rememberLoad(run.id) { parseRunDiff(hub.read("/api/runs/diff?run=${enc(run.id)}")) }
    val diff = load.data
    var all by rememberSaveable(run.id) { mutableStateOf(false) }
    var openFile by rememberSaveable(run.id) { mutableStateOf<String?>(null) }
    val menu = remember { mutableStateOf(false) }
    var revising by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf<String?>(null) }
    var approving by remember { mutableStateOf(false) }
    val chat = { scope.launch { if (hub.openRun(run, null)) onChat() }; Unit }
    SectionHeader(run.title.ifBlank { "Untitled" })
    Group {
        ListRow(
            run.rounds.lastOrNull()?.line?.ifEmpty { null } ?: run.title, reviewMeta(run, diff, now),
            state = { Badge("Needs you", BadgeTone.Waiting) }, onClick = { chat() }, onLongClick = if (hub.readOnly) null else ({ menu.value = true }),
        )
        Hairline()
        when {
            diff != null -> {
                DiffFiles(if (all) diff.files else diff.files.take(SHOWN_FILES), diff.diff, openFile) { openFile = it }
                if (!all && diff.files.size > SHOWN_FILES) Box(Modifier.padding(horizontal = Tokens.listPad)) {
                    Button("Show all ${diff.files.size}", { all = true }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                }
            }
            load.error.isNotEmpty() -> ListRow("Could not load the diff", stateSlot = false, trailing = { Button("Retry", reload, size = ButtonSize.Sm) })
            else -> ListRow("Loading the diff", stateSlot = false)
        }
        if (!hub.readOnly) {
            Hairline()
            ListRow(
                "Commit, push and open a PR", stateSlot = false,
                trailing = {
                    Button(if (approving) "Approving…" else "Approve", { asking = "approve" }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = !approving)
                    MoreButton(expanded = menu) { dismiss ->
                        MenuItem("Revise…", "comment", { dismiss(); revising = true })
                        MenuItem("Open chat", "comment-discussion", { dismiss(); chat() })
                        MenuItem("Discard", "trash", { dismiss(); asking = "discard" }, danger = true)
                    }
                },
            )
        }
    }
    when (asking) {
        "approve" -> ConfirmDialog(
            "Push ${run.branch} and open a PR?", "Nothing is merged.", "Approve",
            { approving = true; hub.runReview("approve", run.id, "Could not open the PR") { approving = false } }, danger = false,
        ) { asking = null }
        "discard" -> ConfirmDialog(
            "Discard this run?", "The worktree and its branch are deleted.", "Discard",
            { hub.runReview("discard", run.id, "Could not discard the run") },
        ) { asking = null }
    }
    if (revising) ReviseSheet({ note, done -> hub.runReview("revise", run.id, "Could not send the note", buildJsonObject { put("text", note) }.toString(), done) }) { revising = false }
}

@Composable
private fun ReviseSheet(send: (String, (Boolean) -> Unit) -> Unit, onDismiss: () -> Unit) {
    var note by remember { mutableStateOf("") }
    var failed by remember { mutableStateOf(false) }
    Sheet(onDismiss, "Revise") {
        TextField(note, { note = it; failed = false }, placeholder = "What should change?", minLines = 4)
        if (failed) Text("Could not send the note. Your note is still here.", Modifier.padding(top = Tokens.sp4), style = Type.meta, color = av.err)
        Button("Send", { send(note.trim()) { ok -> if (ok) onDismiss() else failed = true } }, Modifier.padding(top = Tokens.sp6, bottom = Tokens.sp4), variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = note.isNotBlank())
    }
}

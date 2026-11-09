package no.pradhan.agentview.nativeapp.codex

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.agoShort

// The Replies group of the Needs you sheet (web/src/codex/overview/ReplyQueue.tsx).
@Composable
fun ReplySection(rows: List<Row>, filtered: Boolean, onClear: () -> Unit, now: Long, actions: TaskActions, replies: ReplyOps, onOpen: (Row) -> Unit) {
    if (rows.isEmpty()) return
    val faq = rows.filter(::isFaq)
    val admins = adminCount(rows)
    var sending by remember { mutableStateOf(false) }
    val clip = LocalClipboardManager.current
    val sendText = "Send all ${faq.size} FAQ answers"
    val copyText = "Copy $admins access and limit requests"
    val sendAll = { sending = true; replies.sendAllFaq(faq) { sending = false } }
    val copy = { clip.setText(AnnotatedString(adminList(rows))); actions.say("Copied $admins requests") }
    SectionHeader("Replies", rows.size.toString(), action = {
        when {
            filtered -> {
                Chip("Older than $STALE_DAYS days", onClear, on = true)
                Button("Dismiss all ${rows.size}", { actions.dismissAll(rows) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            }
            faq.size >= 2 && admins >= 2 -> MoreButton { close ->
                MenuItem(sendText, "send", { close(); sendAll() }, enabled = !sending)
                MenuItem(copyText, "copy", { close(); copy() })
            }
            faq.size >= 2 -> Button(sendText, { sendAll() }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !sending)
            admins >= 2 -> Button(copyText, copy, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        }
    })
    Group {
        rows.forEachIndexed { i, r ->
            if (i > 0) Hairline()
            AskRow(r, now, actions, replies) { onOpen(r) }
        }
    }
}

@Composable
private fun AskRow(row: Row, now: Long, actions: TaskActions, replies: ReplyOps, onOpen: () -> Unit) {
    val has = drafted(row)
    val needs = needsMine(row)
    val uri = LocalUriHandler.current
    var editing by remember(row.key) { mutableStateOf(false) }
    var text by remember(row.key) { mutableStateOf(row.draft ?: "") }
    var edited by remember(row.key) { mutableStateOf(false) }
    var busy by remember(row.key) { mutableStateOf(false) }
    var error by remember(row.key) { mutableStateOf("") }
    var showHistory by remember(row.key) { mutableStateOf(false) }
    var history by remember(row.key) { mutableStateOf<Result<ReplyHistory>?>(null) }
    LaunchedEffect(row.draft, editing) { if (!editing) text = row.draft ?: "" }
    LaunchedEffect(showHistory, history == null) {
        val who = row.people
        if (showHistory && history == null && who != null) history = runCatching { replies.history(who) }
    }
    val keep = {
        editing = false
        if (text.trim() != (row.draft ?: "")) { actions.edit(row, mapOf("draft" to text.trim().ifEmpty { null })); edited = true }
    }
    val send = {
        val changed = if (editing) text.trim() != (row.draft ?: "") else edited
        if (editing) keep()
        busy = true
        error = ""
        replies.send(row, text, changed) { ok, failure ->
            busy = false
            if (!ok) error = failure ?: "" else history = null
        }
    }
    val link = safeHref(row.sourceUrl)
    Column {
        ListRow(
            row.title ?: "", listOfNotNull(row.people?.ifEmpty { null } ?: "Slack", agoShort(row.statusTime, now), if (row.snoozedUntil != null) "Snoozed" else null, if (isFaq(row)) "FAQ" else null).joinToString(" · "),
            onClick = onOpen,
            trailing = {
                if (needs) Badge("Needs you", BadgeTone.Waiting)
                if (has) Button(if (error.isNotEmpty()) "Retry" else if (needs) "Send note" else "Send", { send() }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, enabled = !busy)
                else if (link != null) Button("Open", { uri.openUri(link) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                MoreButton { close ->
                    if (has) MenuItem("Edit", "edit", { close(); editing = true })
                    if (has && row.people != null) MenuItem("History", "history", { close(); showHistory = !showHistory })
                    if (has && link != null) MenuItem("Open thread", "link", { close(); uri.openUri(link) })
                    snoozeOptions(now, row.profile).forEach { o -> MenuItem(o.label, "clock", { close(); actions.snoozeAsk(row, o.at) }, enabled = !busy) }
                    MenuItem("Skip", "close", { close(); busy = true; replies.skip(row) { busy = false } }, enabled = !busy)
                }
            },
        )
        Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4)) {
            when {
                !has -> Text("no draft, open the thread", style = Type.meta, color = av.metaFg)
                editing -> {
                    TextField(text, { text = it }, minLines = 3, placeholder = "Reply draft")
                    Button("Done", { keep() }, Modifier.padding(top = Tokens.sp2), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                }
                else -> Text(row.draft ?: "", style = Type.subheadline, color = av.fgMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (showHistory && row.people != null) {
                val h = history
                when {
                    h == null -> Text("Loading…", style = Type.meta, color = av.metaFg)
                    h.isFailure -> Button("Retry history", { history = null }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                    h.getOrThrow().replies.isEmpty() -> Text("No replies sent to ${row.people} yet", style = Type.meta, color = av.metaFg)
                    else -> h.getOrThrow().replies.forEach { Text("${ymd(it.at)} · ${it.line}", style = Type.meta, color = av.metaFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
            if (error.isNotEmpty()) Text("Not sent: $error", style = Type.meta, color = av.err)
        }
    }
}

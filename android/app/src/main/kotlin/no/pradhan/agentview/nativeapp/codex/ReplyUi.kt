package no.pradhan.agentview.nativeapp.codex

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row as LRow
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.material3.HorizontalDivider
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import no.pradhan.agentview.nativeapp.codex.meetings.safeHref
import no.pradhan.agentview.nativeapp.ui.AvIcon
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
import no.pradhan.agentview.nativeapp.ui.agoShort

// The Replies group of the Needs you sheet (web/src/codex/overview/ReplyQueue.tsx).
@Composable
fun ReplySection(rows: List<Row>, filtered: Boolean, onClear: () -> Unit, now: Long, actions: TaskActions, replies: ReplyOps, onOpen: (Row) -> Unit, onAsk: (Row) -> Unit) {
    if (rows.isEmpty()) return
    val faq = rows.filter(::isFaq)
    val admins = adminCount(rows)
    var sending by remember { mutableStateOf(false) }
    val clip = LocalClipboardManager.current
    val sendText = "Send all ${faq.size} FAQ answers"
    val copyText = "Copy $admins access and limit requests"
    val sendAll = { sending = true; replies.sendAllFaq(faq) { sending = false } }
    val copy = { clip.setText(AnnotatedString(adminList(rows))); actions.say("$admins requests copied") }
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
            AskRow(r, now, actions, replies, onAsk) { onOpen(r) }
        }
    }
}

@Composable
private fun AskRow(row: Row, now: Long, actions: TaskActions, replies: ReplyOps, onAsk: (Row) -> Unit, onOpen: () -> Unit) {
    val primary = askPrimary(row)
    val has = primary != "Open"
    val status = askStatus(row)
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
            row.title ?: "", listOfNotNull(row.people?.ifEmpty { null } ?: if (row.source == "gmail") "Gmail" else "Slack", agoShort(row.statusTime, now), if (row.snoozedUntil != null) "Snoozed" else null, if (isFaq(row)) "FAQ" else null).joinToString(" · "),
            onClick = onOpen,
            trailing = {
                if (!has && link != null) Button("Open", { uri.openUri(link) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                MoreButton { close ->
                    askMenu(row).forEach { k ->
                        when (k) {
                            "Edit draft" -> MenuItem(k, "edit", { close(); editing = true })
                            "History" -> MenuItem(k, "history", { close(); showHistory = !showHistory })
                            "Open thread" -> link?.let { l -> MenuItem(k, "link", { close(); uri.openUri(l) }) }
                            "Done" -> MenuItem(k, "check", { close(); actions.done(row) }, enabled = !busy)
                            "Make task" -> MenuItem(k, "add", { close(); actions.toTask(row) }, enabled = !busy)
                            "Snooze" -> snoozeOptions(now, row.profile).forEach { o -> MenuItem(o.label, "clock", { close(); actions.snoozeAsk(row, o.at) }, enabled = !busy) }
                            "Ask Claude" -> MenuItem(k, "sparkle", { close(); onAsk(row) })
                            "Skip" -> MenuItem(k, "close", { close(); if (row.source == "gmail") actions.dismiss(row) else { busy = true; replies.skip(row) { busy = false } } }, enabled = !busy)
                        }
                    }
                }
            },
        )
        Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp4)) {
            val parts = askParts(row.text)
            parts.quote.takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.meta, color = av.metaFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            val showStatus = status != "No draft" || parts.steps.isEmpty()
            if (status == "Needs you") Badge(status, BadgeTone.Waiting)
            else if (showStatus) Text(status, style = Type.meta, color = if (status == "Reply ready") av.fg else av.metaFg)
            parts.steps.forEach { st ->
                LRow(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
                    if (st.done) AvIcon("check", null, Tokens.size2xs, tint = av.metaFg)
                    Text(st.label, style = Type.meta, color = if (st.done) av.metaFg else av.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (drafted(row)) MailCard(row) {
                if (has && editing) {
                    TextField(text, { text = it }, minLines = 3, placeholder = "Reply draft")
                    Button("Done", { keep() }, Modifier.padding(top = Tokens.sp2), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                } else Text(row.draft ?: "", style = Type.subheadline, color = av.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (has) LRow(Modifier.fillMaxWidth().padding(top = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3, Alignment.End)) {
                    Button("Not now", { actions.snoozeAsk(row, snoozeOptions(now, row.profile).first().at) }, size = ButtonSize.Sm, enabled = !busy)
                    Button(if (error.isNotEmpty()) "Retry" else primary, { send() }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = !busy)
                }
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

// Duet's email approval card: To and Re lines over the draft, with its buttons under it.
@Composable
private fun MailCard(row: Row, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(Tokens.shapeMd)
    Column(
        Modifier.padding(top = Tokens.sp2).fillMaxWidth().clip(shape).border(BorderStroke(Tokens.hairline, av.border), shape).background(av.bg).padding(horizontal = Tokens.sp6, vertical = Tokens.sp4),
        verticalArrangement = Arrangement.spacedBy(Tokens.sp2),
    ) {
        listOf("To" to (row.people?.ifEmpty { null } ?: if (row.source == "gmail") "Gmail" else "Slack"), "Re" to (row.title ?: "")).forEach { (k, v) ->
            Text(buildAnnotatedString { withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("$k  ") }; append(v) }, style = Type.subheadline, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        HorizontalDivider(color = av.border, thickness = Tokens.hairline)
        content()
    }
}

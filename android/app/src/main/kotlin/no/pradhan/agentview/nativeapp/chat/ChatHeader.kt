package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.ui.UNTITLED
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.text.style.TextAlign
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.app.archive
import no.pradhan.agentview.nativeapp.net.billing
import no.pradhan.agentview.nativeapp.app.closeChat
import no.pradhan.agentview.nativeapp.app.setOutputStyle
import no.pradhan.agentview.nativeapp.app.rename
import no.pradhan.agentview.nativeapp.ui.IconBtn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import no.pradhan.agentview.nativeapp.sessions.chatPlace
import no.pradhan.agentview.nativeapp.sessions.groupByRepo
import no.pradhan.agentview.nativeapp.sessions.newChatChoices
import no.pradhan.agentview.nativeapp.sessions.startedFrom
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuSeparator
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.WordClamp
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.rememberNow
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.plural

// Takes the fields it shows, not the ChatView, so a streamed token batch does not redraw the header.
@Composable
internal fun ChatHeader(hub: Hub, live: LiveChat, session: SessionInfo?, cost: Double, panels: ChatPanels, canReview: Boolean, running: Boolean, cwd: String, onChats: (() -> Unit)?, onReview: () -> Unit) {
    val ws by hub.workspace.collectAsState()
    var newChat by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().height(Tokens.tabbarH).padding(horizontal = Tokens.sp2), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        if (onChats != null) IconBtn("menu", "Chats", onChats, tint = av.fg) else Spacer(Modifier.width(Tokens.sp6))
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(live.title.ifBlank { UNTITLED }, style = Type.headline.copy(fontWeight = FontWeight.Medium), color = av.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(chatPlace(ws, cwd), style = Type.footnote, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconBtn("edit", "New chat", { newChat = true }, tint = av.fg)
        ChatMenu(hub, live, session, panels, canReview, running, cwd, onReview)
    }
    val from = remember(ws.saved, live.sessionId, session?.sessionId) { startedFrom(ws.saved, live.sessionId ?: session?.sessionId) }
    if (from != null) {
        val scope = rememberCoroutineScope()
        Text(from.text, style = Type.footnote, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.touchSm).clickable { scope.launch { hub.openSaved(from.sessionId) } }.wrapContentHeight().padding(horizontal = Tokens.listPad))
    }
    if (newChat) NewChatFromHeader(hub, cwd) { newChat = false }
}

// The New chat sheet the Sessions button opens, with this chat's repo first.
@Composable
private fun NewChatFromHeader(hub: Hub, cwd: String, onDismiss: () -> Unit) {
    val chats by hub.store.state.select { it.live }
    val ws by hub.workspace.collectAsState()
    val (here, choices) = newChatChoices(groupByRepo(chats, ws), ws, cwd)
    NewChatSheet(hub, null, choices, onDismiss = onDismiss, initial = here)
}

// One line under the title: what the chat is doing, and on the right the agents and run controls it opens.
@Composable
internal fun ChatStatus(live: LiveChat, session: SessionInfo?, viewCost: Double, replyAt: Long?, agents: Int?, onAgents: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = Tokens.listPad, end = Tokens.sp2, bottom = Tokens.sp2), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f, fill = false)) { ChatSubtitle(live, session, viewCost, replyAt) }
        if (agents != null) Row(Modifier.heightIn(min = Tokens.touchSm).clip(RoundedCornerShape(Tokens.radius)).clickable(onClick = onAgents).padding(start = Tokens.sp4, end = Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
            Text(if (agents > 0) plural(agents, "agent") else "Run", style = Type.footnote, color = av.fgMuted, maxLines = 1)
            AvIcon("chevron-right", null, Tokens.iconSm, tint = av.fgMuted)
        }
    }
}

// The build chat's task line under the status (web Brief.tsx tl-build).
@Composable
internal fun BuildHead(text: String, full: String = text) {
    var open by remember(full) { mutableStateOf(false) }
    Text(if (open) full else text, Modifier.fillMaxWidth().clickable(enabled = full != text) { open = !open }.padding(start = Tokens.listPad, end = Tokens.sp2, bottom = Tokens.sp2), style = Type.footnote, color = av.fgMuted, maxLines = if (open) Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun ChatSubtitle(live: LiveChat, session: SessionInfo?, viewCost: Double, replyAt: Long?) {
    val status = statusLine(live, session)
    val idleAt = replyAt.takeIf { status.text == "Idle" }
    val now = rememberNow(idleAt != null)
    val replied by remember(idleAt) { derivedStateOf { idleAt?.let { replyTime(it, now.value) } } }
    val cost = live.cost ?: viewCost
    val toneColor = when (status.tone) { ChatTone.Running -> av.agent; ChatTone.Needs -> av.warn; ChatTone.Failed -> av.err; ChatTone.Warn -> av.warn; ChatTone.Idle -> av.fgMuted }
    val muted = av.fgMuted
    val usage = session?.usage
    val warn = av.warn
    val line = remember(status, replied, cost, toneColor, muted, usage) {
        buildAnnotatedString {
            withStyle(SpanStyle(color = toneColor)) { append(status.text) }
            replied?.let { withStyle(SpanStyle(color = muted)) { append(" · $it") } }
            costLabel(cost, billing(live.provider)).takeIf { it.isNotEmpty() }?.let { withStyle(SpanStyle(color = muted)) { append(" · $it") } }
            usageText(usage).takeIf { it.isNotEmpty() }?.let { withStyle(SpanStyle(color = if (usageHigh(usage)) warn else muted)) { append(" · $it") } }
        }
    }
    WordClamp(line, Type.subheadline, muted, 1)
}

@Composable
private fun ChatMenu(hub: Hub, live: LiveChat, session: SessionInfo?, panels: ChatPanels, canReview: Boolean, running: Boolean, cwd: String, onReview: () -> Unit) {
    val sessionId = live.sessionId ?: session?.sessionId
    MoreButton { close ->
        MenuItem(reviewLabel(false, canReview), "source-control", { close(); onReview() }, enabled = canReview)
        if (live.provider != "codex") {
            val style = outputStyleLabel(session?.outputStyle)
            var styles by remember { mutableStateOf(false) }
            MenuItem("Output style \u00b7 $style", "comment", { styles = !styles })
            if (styles) OUTPUT_STYLES.forEach { l -> MenuItem(l, "", { close(); hub.setOutputStyle(outputStyleValue(l)) }, checked = l == style) }
        }
        MenuItem("Find in chat", "search", { close(); panels.find = true })
        MenuItem("Rename", "edit", { close(); panels.dialog = "rename" }, enabled = sessionId != null)
        MenuItem("Tools\u2026", "tools", { close(); panels.tools = true })
        MenuItem("Close chat", "close", { close(); if (running || live.pending > 0) panels.dialog = "close" else hub.closeChat(live.id) })
        MenuSeparator()
        MenuItem("Archive", "archive", { close(); panels.dialog = "archive" }, danger = true, enabled = sessionId != null)
    }
}

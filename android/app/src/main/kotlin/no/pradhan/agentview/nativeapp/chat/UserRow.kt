package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextOverflow
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.net.providerLabel
import no.pradhan.agentview.nativeapp.app.sendNow
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MenuLabel
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun UserBubble(onLongClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Column(
            Modifier.widthIn(max = maxWidth * 0.85f).clip(RoundedCornerShape(Tokens.shapeLg)).background(av.fg.copy(alpha = 0.05f))
                .then(if (onLongClick != null) Modifier.combinedClickable(onClick = {}, onLongClick = onLongClick) else Modifier)
                .padding(horizontal = Tokens.sp8, vertical = Tokens.sp6),
            verticalArrangement = Arrangement.spacedBy(Tokens.sp3),
            content = content,
        )
    }
}

@Composable
private fun BubbleFooter(label: String, action: String, onClick: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp5), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f, fill = false), style = Type.footnote, color = av.fgMuted)
        Button(action, onClick, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    }
}

@Composable
internal fun UserRow(hub: Hub, it: Item.User, chat: String, readOnly: Boolean = false) {
    val label = providerLabel(hub.store.state.value.session?.provider)
    val haptic = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    val menuable = !it.queued && !it.stopping && !hub.readOnly && !readOnly
    UserBubble(if (menuable) ({ haptic.performHapticFeedback(HapticFeedbackType.LongPress); menu = true }) else null) {
        Menu(menu, { menu = false }) {
            if (it.at > 0) MenuLabel("Sent ${sentAt(it.at, System.currentTimeMillis())}")
            MenuItem("Use again", "reply", { menu = false; hub.useAgain(chat, it.text) })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
            if (it.voice) AvIcon("mic", "Spoken", Tokens.iconSm, Modifier.padding(top = Tokens.sp1), tint = av.fgMuted)
            Column(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
                userParts(it.text).forEachIndexed { i, p -> when (p) {
                    is Part.Text -> FoldText("${it.id}:$i", p.text)
                    is Part.Image -> ChatImage(hub, chat, p.path)
                } }
            }
        }
        if (it.stopping) Text("Stopping $label to send this", style = Type.footnote, color = av.fgMuted)
        if (it.queued) BubbleFooter("Waiting for $label's next step", "Send now") { hub.sendNow(it.id) }
    }
}

private const val FOLD_LINES = 6

@Composable
private fun FoldText(key: String, text: String) {
    var open by rememberSaveable(key) { mutableStateOf(false) }
    var long by remember(key) { mutableStateOf(false) }
    Text(
        text, style = Type.body, color = av.fg,
        maxLines = if (open) Int.MAX_VALUE else FOLD_LINES, overflow = TextOverflow.Ellipsis,
        onTextLayout = { long = if (open) it.lineCount > FOLD_LINES else it.hasVisualOverflow },
    )
    if (long) Button(if (open) "Show less" else "Show more", { open = !open }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
}

@Composable
internal fun QueuedRow(hub: Hub, q: Queued) {
    UserBubble {
        Text(q.text, style = Type.body, color = av.fgMuted)
        BubbleFooter("Waiting to send", "Cancel") { hub.cancelQueued(q.id) }
    }
}

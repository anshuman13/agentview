package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.PrefsKeyValue
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

// A link-coloured text action at the right of a card header (web OpenLink).
@Composable
internal fun LinkAction(label: String, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = Tokens.touch).clickable(onClickLabel = label, onClick = onClick).padding(horizontal = Tokens.sp3), contentAlignment = Alignment.Center) {
        Text(label, style = Type.callout, color = av.link)
    }
}

// Web chat/transcript/Box.tsx: the Report card header (icon, headline title, action) over a hairline and the body; the header toggles the body, and the open state is kept per box id on this device.
// With onOpen the card has no body to fold: the header opens the thing instead. A plain box is a faint line at the right until opened.
@Composable
internal fun TranscriptBox(
    hub: Hub,
    id: String,
    title: CharSequence,
    meta: String = "",
    state: (@Composable RowScope.() -> Unit)? = null,
    action: (@Composable RowScope.() -> Unit)? = null,
    summary: String? = null,
    reserveSummary: Boolean = false,
    fitState: Boolean = false,
    defaultOpen: Boolean = false,
    open: Boolean? = null,
    onToggle: (() -> Unit)? = null,
    plain: Boolean = false,
    icon: String? = null,
    onOpen: (() -> Unit)? = null,
    content: @Composable () -> Unit = {},
) {
    val kv = remember(hub) { PrefsKeyValue(hub.prefs) }
    var saved by remember(id) { mutableStateOf(readBox(kv, id, defaultOpen)) }
    val shown = open ?: saved
    val shape = RoundedCornerShape(Tokens.shapeLg)
    val toggle = { if (onToggle != null) onToggle() else { saved = !saved; saveBox(kv, id, saved) } }
    if (plain && !shown) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = Tokens.touchSm).clickable(onClick = toggle).padding(horizontal = Tokens.listPad, vertical = Tokens.sp3),
            horizontalArrangement = Arrangement.spacedBy(Tokens.sp2, Alignment.End), verticalAlignment = Alignment.CenterVertically,
        ) {
            AvIcon("chevron-right", null, Tokens.iconSm, tint = av.fgFaint)
            if (title is AnnotatedString) Text(title, style = Type.footnote, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            else Text(title.toString(), style = Type.footnote, color = av.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            state?.invoke(this)
        }
        return
    }
    Column(Modifier.fillMaxWidth().background(av.surface, shape).border(BorderStroke(Tokens.hairline, av.border), shape).clip(shape)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = Tokens.rowOne).clickable(onClick = onOpen ?: toggle).padding(start = Tokens.listPad, end = Tokens.sp4, top = Tokens.sp3, bottom = Tokens.sp3),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp6),
        ) {
            val chevron = if (shown) "chevron-down" else "chevron-right"
            if (icon != null) AvIcon(icon, null, Tokens.icon, tint = av.fgMuted) else AvIcon(chevron, null, Tokens.iconSm, tint = av.fgMuted)
            Column(Modifier.weight(1f)) {
                Text(title.toString(), style = Type.headline, color = av.fg, maxLines = if (fitState) 2 else 1, overflow = TextOverflow.Ellipsis)
                if (meta.isNotEmpty()) Text(meta, style = Type.meta, color = av.metaFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            state?.invoke(this)
            action?.invoke(this)
            if (icon != null && onOpen == null) AvIcon(chevron, null, Tokens.iconSm, tint = av.fgFaint)
        }
        if (!summary.isNullOrEmpty()) Text(
            summary,
            Modifier.padding(start = Tokens.listPad + Tokens.leadWidth + Tokens.sp8, end = Tokens.listPad, bottom = Tokens.sp5),
            style = Type.meta, color = av.metaFg, minLines = if (reserveSummary) 2 else 1, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        if (shown && onOpen == null) {
            HorizontalDivider(color = av.border, thickness = Tokens.hairline)
            content()
        }
    }
}

package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.PrefsKeyValue
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

// Web chat/transcript/Box.tsx: a collapsible transcript box whose header toggles it; the open state is kept per box id on this device.
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
    defaultOpen: Boolean = false,
    open: Boolean? = null,
    onToggle: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val kv = remember(hub) { PrefsKeyValue(hub.prefs) }
    var saved by remember(id) { mutableStateOf(readBox(kv, id, defaultOpen)) }
    val shown = open ?: saved
    val shape = RoundedCornerShape(Tokens.radius)
    Column(Modifier.fillMaxWidth().background(av.raised, shape).border(BorderStroke(Tokens.hairline, av.border), shape).clip(shape)) {
        ListRow(
            title, meta.ifEmpty { null },
            leading = { AvIcon(if (shown) "chevron-down" else "chevron-right", null, Tokens.iconSm) },
            state = state, trailing = action, lines = 1,
            onClick = { if (onToggle != null) onToggle() else { saved = !saved; saveBox(kv, id, saved) } },
        )
        if (!summary.isNullOrEmpty()) Text(
            summary,
            Modifier.padding(start = Tokens.listPad + Tokens.leadWidth + Tokens.sp8, end = Tokens.listPad, bottom = Tokens.sp5),
            style = Type.meta, color = av.metaFg, minLines = if (reserveSummary) 2 else 1, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        if (shown) content()
    }
}

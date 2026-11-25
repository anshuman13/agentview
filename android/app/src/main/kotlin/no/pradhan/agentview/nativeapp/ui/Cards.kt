package no.pradhan.agentview.nativeapp.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Hairline preview card (web ui/Card.tsx) for Travel trips and Sketches: 16:10 cover on top, title and caption below.
@Composable
fun Card(
    title: String,
    modifier: Modifier = Modifier,
    meta: String? = null,
    selected: Boolean = false,
    cover: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    menu: (@Composable () -> Unit)? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val shape = RoundedCornerShape(Tokens.shapeLg)
    val ring = if (selected) BorderStroke(2.dp, av.accent) else BorderStroke(Tokens.hairline, av.border)
    val click = if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier
    Column(modifier.fillMaxWidth().clip(shape).background(av.surface).border(ring, shape).semantics { this.selected = selected }.then(click)) {
        if (cover != null) {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 10f).background(av.groupCard)) { cover() }
            HorizontalDivider(color = av.border, thickness = Tokens.hairline)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(start = Tokens.sp6, end = if (menu != null) Tokens.sp2 else Tokens.sp6, top = Tokens.sp5, bottom = Tokens.sp6), verticalArrangement = Arrangement.spacedBy(Tokens.sp1)) {
                Text(title, style = Type.body.copy(fontWeight = FontWeight.Medium), color = av.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (!meta.isNullOrEmpty()) Text(meta, style = Type.meta, color = av.metaFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                content?.invoke(this)
            }
            if (menu != null) Box(Modifier.padding(end = Tokens.sp2)) { menu() }
        }
    }
}

// Columns of a card grid (web .ui-card-grid): as many 220dp tracks as fit, one column at 600dp and below.
fun cardColumns(width: Dp, gap: Dp = Tokens.sp6): Int =
    if (width <= 600.dp) 1 else ((width + gap) / (220.dp + gap)).toInt().coerceAtLeast(1)

// Grid of cards for a non-lazy page; rows fill the width with equal columns.
@Composable
fun <T> CardGrid(items: List<T>, modifier: Modifier = Modifier, card: @Composable (T) -> Unit) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val cols = cardColumns(maxWidth)
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
            items.chunked(cols).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
                    row.forEach { Box(Modifier.weight(1f)) { card(it) } }
                    repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

package no.pradhan.agentview.nativeapp.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import no.pradhan.agentview.nativeapp.app.icon
import no.pradhan.agentview.nativeapp.app.text

// The shared components, one per web primitive (web/src/ui and web/src/styles/components). Screens build only from these and the tokens.

val Mono = TextStyle(fontFamily = MonoFont, fontSize = Tokens.fsSubheadline, lineHeight = Tokens.lineMd)

// Page header with an optional back button: 64dp, a one-line title ending in an ellipsis and an optional muted subtitle.
@Composable
fun PageHeader(title: String, onBack: (() -> Unit)? = null, subtitle: (@Composable () -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().height(Tokens.tabbarH).padding(start = if (onBack == null) Tokens.listPad else Tokens.sp2, end = Tokens.sp2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.sp2),
    ) {
        if (onBack != null) IconBtn("arrow-left", "Back", onBack, tint = av.fg)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
            Text(title, style = Type.title, color = av.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) CompositionLocalProvider(LocalContentColor provides av.fgMuted) { ProvideTextStyle(Type.subheadline, subtitle) }
        }
        actions()
    }
}

// Section header (web Section): muted label, a quiet count badge, a chevron when it folds, actions at the end.
@Composable
fun SectionHeader(label: String, count: String? = null, open: Boolean? = null, onToggle: (() -> Unit)? = null, color: Color = av.fgMuted, action: (@Composable RowScope.() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(top = Tokens.sp3, end = Tokens.listPad), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        Row(
            Modifier.weight(1f).heightIn(min = Tokens.touchMd).then(if (onToggle != null) Modifier.clickable(onClick = onToggle) else Modifier).padding(horizontal = Tokens.listPad, vertical = Tokens.sp4),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.sp4),
        ) {
            if (onToggle != null) AvIcon("chevron-right", null, Tokens.icon, Modifier.rotate(if (open == true) 90f else 0f), tint = color)
            Text(label, style = Type.callout, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (count != null) Badge(count, BadgeTone.Quiet)
        }
        if (action != null) CompositionLocalProvider(LocalContentColor provides av.fgMuted) { action() }
    }
}

// Inset grouped list card (web .ui-group).
@Composable
fun Group(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = Tokens.sp8).fillMaxWidth().clip(RoundedCornerShape(Tokens.shapeLg)).background(av.groupCard), content = content)
}

// Group for long lists: one lazy item per row, the card corners drawn on the first and last.
fun <T> LazyListScope.lazyGroup(rows: List<T>, key: (T) -> Any, lead: Boolean = false, row: @Composable (T) -> Unit) {
    itemsIndexed(rows, key = { _, r -> key(r) }) { i, r ->
        val top = if (i == 0) Tokens.shapeLg else 0.dp
        val bottom = if (i == rows.lastIndex) Tokens.shapeLg else 0.dp
        Column(Modifier.padding(start = Tokens.listPad, end = Tokens.listPad, bottom = if (i == rows.lastIndex) Tokens.sp8 else 0.dp).fillMaxWidth().clip(RoundedCornerShape(top, top, bottom, bottom)).background(av.groupCard)) {
            if (i > 0) Hairline(lead)
            row(r)
        }
    }
}

@Composable
fun Hairline(lead: Boolean = false) = HorizontalDivider(Modifier.padding(start = Tokens.listPad + if (lead) Tokens.leadWidth + Tokens.sp8 else 0.dp), color = av.border, thickness = Tokens.hairline)

// List row (web Row): leading slot, a title of one or two lines, a meta line and trailing content.
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ListRow(
    title: CharSequence,
    meta: CharSequence? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    lines: Int = 2,
    metaLines: Int = 1,
    below: (@Composable RowScope.() -> Unit)? = null,
    strike: Boolean = false,
    muted: Boolean = false,
    selected: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
    val click = if (onClick != null || onLongClick != null) Modifier.combinedClickable(onClick = { onClick?.invoke() }, onLongClick = onLongClick) else Modifier
    Row(
        modifier.fillMaxWidth().background(if (selected) av.accentSoft else Color.Transparent).heightIn(min = if (meta.isNullOrEmpty()) Tokens.rowOne else Tokens.rowTwo).then(click)
            .padding(start = Tokens.listPad, end = if (trailing != null) Tokens.sp4 else Tokens.listPad, top = Tokens.sp5, bottom = Tokens.sp5),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.sp8),
    ) {
        if (leading != null) Box(Modifier.widthIn(min = Tokens.leadWidth), contentAlignment = Alignment.Center) { CompositionLocalProvider(LocalContentColor provides av.fgMuted) { leading() } }
        Column(Modifier.weight(1f)) {
            val color = if (strike || muted) av.fgMuted else av.fg
            val deco = if (strike) TextDecoration.LineThrough else null
            WordClamp(title.toAnnotated(), Type.body, color, lines, deco)
            if (!meta.isNullOrEmpty()) WordClamp(meta.toAnnotated(), Type.meta, av.metaFg, metaLines, null)
            if (below != null) Row(Modifier.fillMaxWidth().padding(top = Tokens.sp3), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                CompositionLocalProvider(LocalContentColor provides av.fgMuted) { below() }
            }
        }
        if (trailing != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            CompositionLocalProvider(LocalContentColor provides av.fgMuted) { trailing() }
        }
    }
}

private fun CharSequence.toAnnotated() = this as? AnnotatedString ?: AnnotatedString(toString())

// Clamped text that ends at a word boundary with an ellipsis instead of cutting a word.
@Composable
fun WordClamp(text: AnnotatedString, style: TextStyle, color: Color, maxLines: Int, deco: TextDecoration? = null, modifier: Modifier = Modifier) {
    var end by remember(text, maxLines) { mutableIntStateOf(text.length) }
    val width = remember(text, maxLines) { IntArray(1) }
    val shown = if (end >= text.length) text else buildAnnotatedString { append(text.subSequence(0, end)); append("\u2026") }
    Text(shown, modifier, style = style, color = color, maxLines = maxLines, overflow = TextOverflow.Clip, textDecoration = deco, onTextLayout = { r ->
        val w = r.layoutInput.constraints.maxWidth
        val grew = w > width[0] && width[0] > 0
        width[0] = w
        if (grew && end < text.length) { end = text.length; return@Text }
        if (r.hasVisualOverflow && end > 0) {
            val e = if (end >= text.length) r.getLineEnd(maxLines - 1, visibleEnd = true) else text.text.lastIndexOf(' ', end - 1).let { if (it > 0) it else end - 1 }
            end = text.text.substring(0, e.coerceIn(0, text.length)).trimEnd().length
        }
    })
}

// Small status word at the end of a row, in a status colour.
@Composable
fun RowLabel(text: String, color: Color = av.fgMuted) = Text(text, style = Type.label, color = color, maxLines = 1)

// Loading state: a spinner above one muted line.
@Composable
fun Loading(text: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = Tokens.sp8, vertical = Tokens.sp24), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Tokens.sp6)) {
        CircularProgressIndicator(Modifier.size(Tokens.iconMd), color = av.accent, strokeWidth = Tokens.sp1)
        Text(text, style = Type.subheadline, color = av.fgMuted, textAlign = TextAlign.Center)
    }
}

// Empty state (web EmptyState): optional round icon, title, muted hint and an action.
@Composable
fun EmptyState(title: String, hint: String? = null, icon: String? = null, small: Boolean = true, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Tokens.sp8, vertical = if (small) Tokens.sp12 else Tokens.sp24),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Tokens.sp2),
    ) {
        if (icon != null) Box(Modifier.padding(bottom = Tokens.sp2).size(if (small) Tokens.sp20 else Tokens.sp24).clip(CircleShape).background(av.hover), contentAlignment = Alignment.Center) {
            AvIcon(icon, null, if (small) Tokens.iconLg else Tokens.iconXl, tint = av.onSurfaceMuted)
        }
        Text(title, style = Type.headline, color = av.onSurface, textAlign = TextAlign.Center)
        if (hint != null) Text(hint, Modifier.widthIn(max = Tokens.emptyHint), style = Type.body, color = av.onSurfaceMuted, textAlign = TextAlign.Center)
        if (action != null) { Spacer(Modifier.height(Tokens.sp6)); action() }
    }
}

// Panel (web Panel): surface card with a hairline ring.
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(Tokens.shapeLg)
    Column(modifier.fillMaxWidth().clip(shape).background(av.surface).border(BorderStroke(Tokens.hairline, av.border), shape).padding(Tokens.sp7), verticalArrangement = Arrangement.spacedBy(Tokens.sp6), content = content)
}

// Inset well for code, output and diffs.
fun Modifier.well(c: AvColors): Modifier {
    val shape = RoundedCornerShape(Tokens.radiusSm)
    return fillMaxWidth().clip(shape).background(c.containerLowest).border(BorderStroke(Tokens.hairline, c.border), shape)
}

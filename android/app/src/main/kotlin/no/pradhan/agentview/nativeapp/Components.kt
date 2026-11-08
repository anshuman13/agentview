package no.pradhan.agentview.nativeapp

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

// The shared components, one per web primitive (web/src/ui and web/src/styles/components). Screens build only from these and the tokens.

val Mono = TextStyle(fontFamily = FontFamily.Monospace, fontSize = Tokens.fsSubheadline, lineHeight = Tokens.lineMd)

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
fun SectionHeader(label: String, count: String? = null, open: Boolean? = null, onToggle: (() -> Unit)? = null, color: Color = av.fgMuted, style: TextStyle = Type.callout, titleColor: Color = color, action: (@Composable RowScope.() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(top = Tokens.sp3, end = Tokens.listPad), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        Row(
            Modifier.weight(1f).heightIn(min = Tokens.touchMd).then(if (onToggle != null) Modifier.clickable(onClick = onToggle) else Modifier).padding(horizontal = Tokens.listPad, vertical = Tokens.sp4),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.sp4),
        ) {
            if (onToggle != null) AvIcon("chevron-right", null, Tokens.icon, Modifier.rotate(if (open == true) 90f else 0f), tint = color)
            Text(label, style = style, color = titleColor, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
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

enum class ButtonVariant { Filled, Tinted, Gray, Plain, Danger }
enum class ButtonSize { Sm, Md, Lg }

// Button (web Button, iOS styles): a pill with a filled, tinted, gray, plain or danger fill.
@Composable
fun Button(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Gray,
    size: ButtonSize = ButtonSize.Md,
    icon: String? = null,
    enabled: Boolean = true,
    fill: Boolean = false,
) {
    val c = av
    val (bg, fg) = when (variant) {
        ButtonVariant.Filled -> c.accent to c.onAccent
        ButtonVariant.Tinted -> c.accentSoft to c.onSecondaryContainer
        ButtonVariant.Gray -> c.sunken to c.accentText
        ButtonVariant.Plain -> Color.Transparent to c.accentText
        ButtonVariant.Danger -> c.errContainer to c.onErrContainer
    }
    val (h, pad, style) = when (size) {
        ButtonSize.Sm -> Triple(Tokens.controlSm, Tokens.sp6, Type.callout)
        ButtonSize.Md -> Triple(Tokens.buttonMd, Tokens.sp8, Type.body.copy(fontWeight = FontWeight.Medium))
        ButtonSize.Lg -> Triple(Tokens.buttonLg, Tokens.sp12, Type.body.copy(fontWeight = FontWeight.SemiBold))
    }
    val gap = when (size) { ButtonSize.Sm -> Tokens.sp2; ButtonSize.Md -> Tokens.sp3; ButtonSize.Lg -> Tokens.sp4 }
    val shape = if (size == ButtonSize.Lg) RoundedCornerShape(Tokens.shapeLg) else RoundedCornerShape(Tokens.radiusPill)
    Row(
        modifier.minimumInteractiveComponentSize().then(if (fill) Modifier.fillMaxWidth() else Modifier).height(h).alpha(if (enabled) 1f else 0.38f).clip(shape).background(bg)
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = pad),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(gap, Alignment.CenterHorizontally),
    ) {
        if (icon != null) AvIcon(icon, null, Tokens.iconSm, tint = fg)
        Text(text, style = style, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// A codicon glyph (web Icon): drawn from the bundled font at a fixed size that ignores the font scale.
@Composable
fun AvIcon(name: String, desc: String? = null, size: Dp = Tokens.icon, modifier: Modifier = Modifier, tint: Color = LocalContentColor.current) {
    val code = Codicons.codepoints[name] ?: return
    val px = with(LocalDensity.current) { size.toSp() }
    Box(
        modifier.size(size).then(if (desc != null) Modifier.semantics { contentDescription = desc } else Modifier.clearAndSetSemantics {}),
        contentAlignment = Alignment.Center,
    ) {
        Text(String(Character.toChars(code)), style = TextStyle(fontFamily = CodiconFont, fontSize = px, lineHeight = px, color = tint), maxLines = 1, softWrap = false)
    }
}

private val CodiconFont = FontFamily(Font(R.font.codicon))

// Icon button (web IconButton): a muted glyph with a touch-sized target, accent when on.
@Composable
fun IconBtn(icon: String, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, on: Boolean = false, enabled: Boolean = true, tint: Color? = null) {
    Box(
        modifier.size(Tokens.touch).clickable(interactionSource = remember { MutableInteractionSource() }, indication = ripple(bounded = false, radius = Tokens.controlMd / 2), enabled = enabled, onClickLabel = label, onClick = onClick).alpha(if (enabled) 1f else 0.38f),
        contentAlignment = Alignment.Center,
    ) { AvIcon(icon, label, Tokens.iconLg, tint = tint ?: if (on) av.accentText else av.fgMuted) }
}

enum class ChipTone { Default, Work, Personal }

// Chip (web Chip): quiet by default, filled when on, red when late, warn-coloured when warn, dashed-quiet for an unset value. A profile tone adds a leading dot.
@Composable
fun Chip(
    text: String,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    on: Boolean = false,
    late: Boolean = false,
    warn: Boolean = false,
    tone: ChipTone = ChipTone.Default,
    quiet: Boolean = false,
    icon: String? = null,
    trailingIcon: String? = null,
    trailingLabel: String? = null,
) {
    val c = av
    val fg = when {
        late -> c.err
        warn -> c.warn
        on -> c.onSecondaryContainer
        else -> c.fgMuted
    }
    val bg = if (on) c.accentSoft else Color.Transparent
    val dot = when (tone) { ChipTone.Work -> c.work; ChipTone.Personal -> c.personal; ChipTone.Default -> null }
    val shape = RoundedCornerShape(Tokens.radiusMd)
    val outline = when {
        quiet -> Modifier.dashedBorder(Tokens.hairline, c.borderStrong, Tokens.radiusMd)
        !on -> Modifier.border(Tokens.hairline, c.border, shape)
        else -> Modifier
    }
    Row(
        modifier.minimumInteractiveComponentSize().height(Tokens.size2xl).clip(shape).background(bg).then(outline)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = Tokens.sp6),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.sp3),
    ) {
        if (dot != null) Box(Modifier.size(Tokens.dot).clip(CircleShape).background(dot))
        if (icon != null) AvIcon(icon, null, Tokens.iconSm, tint = fg)
        Text(text, style = Type.callout, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (trailingIcon != null) AvIcon(trailingIcon, trailingLabel, Tokens.iconSm, tint = fg)
    }
}

fun Modifier.dashedBorder(width: Dp, color: Color, radius: Dp) = drawBehind {
    val w = width.toPx()
    val r = radius.toPx()
    drawRoundRect(color, Offset(w / 2, w / 2), Size(size.width - w, size.height - w), CornerRadius(r, r), Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(w * 3, w * 3))))
}

enum class Status { Neutral, Ok, Warn, Err, Run, Agent, Info }

@Composable
fun Status.color(): Color = when (this) {
    Status.Neutral -> av.fgMuted
    Status.Ok -> av.ok
    Status.Warn -> av.warn
    Status.Err -> av.err
    Status.Run, Status.Agent -> av.agent
    Status.Info -> av.info
}

@Composable
fun Status.container(): Color = when (this) {
    Status.Neutral -> av.sunken
    Status.Ok -> av.okContainer
    Status.Warn -> av.warnContainer
    Status.Err -> av.errContainer
    Status.Run, Status.Agent -> av.agentContainer
    Status.Info -> av.infoContainer
}

@Composable
fun Status.onContainer(): Color = when (this) {
    Status.Neutral -> av.fg
    Status.Ok -> av.onOkContainer
    Status.Warn -> av.onWarnContainer
    Status.Err -> av.onErrContainer
    Status.Run, Status.Agent -> av.onAgentContainer
    Status.Info -> av.onInfoContainer
}

// Static tag (web .chip with a status tone): the status container with its on-container text.
@Composable
fun Tag(text: String, status: Status = Status.Neutral, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier.clip(RoundedCornerShape(Tokens.radiusSm)).background(status.container()).padding(horizontal = Tokens.sp3),
        style = Type.footnote.copy(lineHeight = Tokens.lineSm), color = status.onContainer(), maxLines = 1,
    )
}

enum class BadgeTone { Default, Quiet, Waiting, Done, Failed, New, Running }

@Composable
fun Chevron() = AvIcon("chevron-right", null, Tokens.iconSm, Modifier.padding(end = Tokens.sp4), tint = av.fgMuted)

// Badge (web Badge): a small pill with a count or a status word.
@Composable
fun Badge(text: String, tone: BadgeTone = BadgeTone.Default, modifier: Modifier = Modifier) {
    val c = av
    val (bg, fg) = when (tone) {
        BadgeTone.Default -> c.sunken to c.fg
        BadgeTone.Quiet -> c.sunken to c.fgMuted
        BadgeTone.Waiting -> c.warnContainer to c.onWarnContainer
        BadgeTone.Done -> c.okContainer to c.onOkContainer
        BadgeTone.Failed -> c.errContainer to c.onErrContainer
        BadgeTone.New -> c.infoContainer to c.onInfoContainer
        BadgeTone.Running -> c.agentContainer to c.onAgentContainer
    }
    Box(modifier.defaultMinSize(minWidth = Tokens.size2xs, minHeight = Tokens.size2xs).clip(RoundedCornerShape(Tokens.radiusPill)).background(bg).padding(horizontal = Tokens.sp2), contentAlignment = Alignment.Center) {
        Text(text, style = Type.label.copy(fontWeight = FontWeight.SemiBold, lineHeight = Tokens.lineXs), color = fg, maxLines = 1)
    }
}

enum class DotState { Faint, Ok, Bad, Warn, Busy, Running, Unread, Idle, Agent }

// Status dot (web .dot): running and busy pulse.
@Composable
fun StatusDot(state: DotState, modifier: Modifier = Modifier) {
    val c = av
    val color = when (state) {
        DotState.Faint -> c.fgFaint
        DotState.Ok -> c.ok
        DotState.Bad -> c.err
        DotState.Warn -> c.warn
        DotState.Busy, DotState.Running -> c.agent
        DotState.Unread -> c.info
        DotState.Idle -> Color.Transparent
        DotState.Agent -> Color.Transparent
    }
    val pulse = if (state == DotState.Busy || state == DotState.Running) {
        val t = rememberInfiniteTransition(label = "dot")
        t.animateFloat(1f, 0.6f, infiniteRepeatable(tween(Tokens.dur * 6), RepeatMode.Reverse), label = "pulse").value
    } else 1f
    val ring = when (state) { DotState.Idle -> c.fgMuted; DotState.Agent -> c.agent; else -> null }
    Box(modifier.size(Tokens.dot).alpha(pulse).clip(CircleShape).background(color).then(if (ring != null) Modifier.border(Tokens.stroke, ring, CircleShape) else Modifier))
}

// Text field (web input): sunken fill, hairline border that turns accent on focus.
@Composable
fun TextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    singleLine: Boolean = false,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    pill: Boolean = false,
    style: TextStyle = Type.body,
) {
    val c = av
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(if (pill) Tokens.radiusPill else Tokens.radiusSm)
    BasicTextField(
        value, onValueChange,
        modifier.fillMaxWidth(),
        textStyle = style.copy(color = c.fg),
        cursorBrush = SolidColor(c.accent),
        singleLine = singleLine, minLines = minLines, maxLines = maxLines,
        keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
        interactionSource = interaction,
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clip(shape).background(c.sunken).border(Tokens.hairline, if (focused) c.accent else c.border, shape)
                    .padding(start = if (leading != null) Tokens.sp4 else Tokens.sp6, end = if (trailing != null) Tokens.sp1 else Tokens.sp6),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Tokens.sp3),
            ) {
                leading?.invoke()
                Box(Modifier.weight(1f).padding(vertical = Tokens.sp4)) {
                    if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, style = style, color = c.fgMuted, maxLines = if (singleLine) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
                    inner()
                }
                trailing?.invoke()
            }
        },
    )
}

// Search field (web .jb-search): a pill with a search glyph and a clear button.
@Composable
fun SearchField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    TextField(
        value, onValueChange, modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), placeholder = placeholder, singleLine = true, pill = true,
        leading = { AvIcon("search", null, Tokens.iconMd, tint = av.fgMuted) },
        trailing = if (value.isNotEmpty()) { { IconBtn("close", "Clear", { onValueChange("") }) } } else null,
    )
}

// Field label above a group of controls in a sheet.
@Composable
fun FieldLabel(text: String) = Text(text, style = Type.label, color = av.fgMuted)

// Bottom sheet (web Sheet): a card that rises over a scrim, with a drag handle and a title row.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Sheet(onDismiss: () -> Unit, title: String, padded: Boolean = true, full: Boolean = true, count: String? = null, action: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = av
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = full),
        containerColor = c.containerLow,
        contentColor = c.fg,
        scrimColor = c.scrimStrong,
        shape = RoundedCornerShape(topStart = Tokens.radiusSheet, topEnd = Tokens.radiusSheet),
        tonalElevation = 0.dp,
        dragHandle = {
            Box(Modifier.fillMaxWidth().height(Tokens.sp24), contentAlignment = Alignment.Center) {
                Box(Modifier.size(Tokens.handleWidth, Tokens.handleHeight).clip(RoundedCornerShape(Tokens.radiusXs)).background(c.borderStrong))
            }
        },
    ) {
        Column(Modifier.navigationBarsPadding().verticalScroll(rememberScrollState()).padding(bottom = Tokens.sp8)) {
            Row(Modifier.fillMaxWidth().height(Tokens.rowOne).padding(start = Tokens.listPad, end = if (action != null) Tokens.sp2 else Tokens.listPad), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Text(title, Modifier.weight(1f, fill = false), style = Type.title, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (count != null) Badge(count, BadgeTone.Quiet)
                if (action != null) { Spacer(Modifier.weight(1f)); action() }
            }
            Column(Modifier.padding(horizontal = if (padded) Tokens.sp8 else 0.dp), content = content)
        }
    }
}

// Menu (web Menu): raised card with elevation 3; items are touch height, danger items red.
@Composable
fun Menu(expanded: Boolean, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    DropdownMenu(
        expanded, onDismiss,
        modifier = Modifier.widthIn(min = Tokens.menuMin),
        shape = RoundedCornerShape(Tokens.shapeLg),
        containerColor = av.raised,
        tonalElevation = 0.dp,
        shadowElevation = Tokens.elev3,
        content = content,
    )
}

@Composable
fun MenuItem(text: String, icon: String, onClick: () -> Unit, danger: Boolean = false, enabled: Boolean = true, checked: Boolean = false) {
    val color = if (danger) av.danger else av.fg
    DropdownMenuItem(
        text = {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                AvIcon(if (checked) "check" else icon, null, Tokens.iconMd)
                Text(text, style = Type.body)
            }
        },
        onClick = onClick,
        enabled = enabled,
        colors = MenuDefaults.itemColors(textColor = color, leadingIconColor = color),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Tokens.sp6),
        modifier = Modifier.heightIn(min = Tokens.touch),
    )
}

@Composable
fun MenuSeparator() = HorizontalDivider(Modifier.padding(vertical = Tokens.sp2), color = av.border, thickness = Tokens.hairline)

// The "more" icon button that opens a menu.
@Composable
fun MoreButton(label: String = "More", expanded: MutableState<Boolean> = remember { mutableStateOf(false) }, content: @Composable ColumnScope.(dismiss: () -> Unit) -> Unit) {
    var open by expanded
    Box {
        IconBtn("kebab-vertical", label, { open = true })
        Box(Modifier.matchParentSize().padding(end = Tokens.sp4)) { Menu(open, { open = false }) { content { open = false } } }
    }
}

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

// Snackbar (web .as-snack): inverse surface with an inverse primary action.
@Composable
fun SnackHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    SnackbarHost(state, modifier) { data ->
        Snackbar(
            data,
            shape = RoundedCornerShape(Tokens.radius),
            containerColor = av.inverseSurface,
            contentColor = av.inverseOnSurface,
            actionColor = av.inversePrimary,
        )
    }
}

// Floating add button (web .as-fab): primary container circle with a medium shadow.
@Composable
fun Fab(icon: String, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    androidx.compose.material3.Surface(onClick, modifier.size(Tokens.fab), shape = CircleShape, color = av.primaryContainer, contentColor = av.onPrimaryContainer, shadowElevation = Tokens.shadowMd) {
        Box(contentAlignment = Alignment.Center) { AvIcon(icon, label, Tokens.iconXl) }
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

@Composable
fun Toggle(checked: Boolean, onChange: (Boolean) -> Unit) {
    Switch(checked, onChange, Modifier.padding(end = Tokens.sp4))
}

// Confirm and text dialogs (web Confirm): raised card, plain actions, the destructive one in red.
@Composable
fun ConfirmDialog(title: String, detail: String, action: String, onConfirm: () -> Unit, danger: Boolean = true, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = av.raised,
        shape = RoundedCornerShape(Tokens.shapeLg),
        title = { Text(title, style = Type.headline, color = av.fg) },
        text = { Text(detail, style = Type.body, color = av.fgMuted) },
        confirmButton = { Button(action, { onConfirm(); onDismiss() }, variant = if (danger) ButtonVariant.Danger else ButtonVariant.Filled) },
        dismissButton = { Button("Cancel", onDismiss, variant = ButtonVariant.Plain) },
    )
}

@Composable
fun TextDialog(title: String, initial: String, action: String, onSave: (String) -> Unit, onDismiss: () -> Unit, maxLength: Int = Int.MAX_VALUE, detail: String? = null) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = av.raised,
        shape = RoundedCornerShape(Tokens.shapeLg),
        title = { Text(title, style = Type.headline, color = av.fg) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                if (!detail.isNullOrEmpty()) Text(detail, style = Type.body, color = av.fgMuted)
                TextField(text, { if (it.length <= maxLength) text = it }, singleLine = true)
            }
        },
        confirmButton = { Button(action, { onSave(text); onDismiss() }, variant = ButtonVariant.Filled) },
        dismissButton = { Button("Cancel", onDismiss, variant = ButtonVariant.Plain) },
    )
}

package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow

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

// Floating add button (web .as-fab): primary container circle with a medium shadow.
@Composable
fun Fab(icon: String, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    androidx.compose.material3.Surface(onClick, modifier.size(Tokens.fab), shape = CircleShape, color = av.primaryContainer, contentColor = av.onPrimaryContainer, shadowElevation = Tokens.shadowMd) {
        Box(contentAlignment = Alignment.Center) { AvIcon(icon, label, Tokens.iconXl) }
    }
}

@Composable
fun Toggle(checked: Boolean, onChange: (Boolean) -> Unit) {
    Switch(checked, onChange, Modifier.padding(end = Tokens.sp4))
}

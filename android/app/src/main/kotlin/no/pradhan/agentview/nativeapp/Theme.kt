package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object Sp {
    val s1 = 2.dp
    val s2 = 4.dp
    val s3 = 6.dp
    val s4 = 8.dp
    val s6 = 12.dp
    val s8 = 16.dp
    val s12 = 24.dp
    val s16 = 32.dp
    val tabBar = 56.dp
    val touch = 44.dp
}

@Immutable
class AvColors(
    val bg: Color, val surface: Color, val raised: Color, val border: Color,
    val fg: Color, val fgMuted: Color, val fgFaint: Color,
    val accent: Color, val accentText: Color, val ok: Color, val warn: Color, val err: Color, val agent: Color,
)

private val dark = AvColors(
    bg = Color(0xFF000000), surface = Color(0xFF1C1C1E), raised = Color(0xFF2C2C2E), border = Color(0x99545458),
    fg = Color.White, fgMuted = Color(0x99EBEBF5), fgFaint = Color(0x73EBEBF5),
    accent = Color(0xFF0A84FF), accentText = Color(0xFF409CFF), ok = Color(0xFF30D158), warn = Color(0xFFFF9F0A), err = Color(0xFFFF453A), agent = Color(0xFF5E5CE6),
)

private val light = AvColors(
    bg = Color.White, surface = Color(0xFFF2F2F7), raised = Color.White, border = Color(0xFFE5E5EA),
    fg = Color.Black, fgMuted = Color(0xFF6C6C70), fgFaint = Color(0x993C3C43),
    accent = Color(0xFF007AFF), accentText = Color(0xFF007AFF), ok = Color(0xFF248A3D), warn = Color(0xFFB25000), err = Color(0xFFD70015), agent = Color(0xFF3634A3),
)

val LocalAv = staticCompositionLocalOf { dark }
val av: AvColors @Composable get() = LocalAv.current

private fun t(size: Int, line: Double, weight: FontWeight = FontWeight.Normal) = TextStyle(fontSize = size.sp, lineHeight = (size * line).sp, fontWeight = weight)

private val typography = Typography(
    headlineLarge = t(34, 1.3, FontWeight.Bold),
    headlineMedium = t(28, 1.3, FontWeight.Bold),
    headlineSmall = t(22, 1.3, FontWeight.Bold),
    titleLarge = t(20, 1.3, FontWeight.SemiBold),
    titleMedium = t(17, 1.4, FontWeight.SemiBold),
    titleSmall = t(15, 1.4, FontWeight.SemiBold),
    bodyLarge = t(17, 1.5),
    bodyMedium = t(16, 1.5),
    bodySmall = t(15, 1.4),
    labelLarge = t(15, 1.4, FontWeight.Medium),
    labelMedium = t(13, 1.3),
    labelSmall = t(12, 1.3),
)

@Composable
fun AgentViewTheme(content: @Composable () -> Unit) {
    val isDark = isSystemInDarkTheme()
    val c = if (isDark) dark else light
    val scheme = if (isDark) {
        darkColorScheme(
            primary = c.accent, onPrimary = Color.White, primaryContainer = c.accent, onPrimaryContainer = Color.White,
            background = c.bg, onBackground = c.fg, surface = c.bg, onSurface = c.fg, surfaceVariant = c.surface, onSurfaceVariant = c.fgMuted,
            surfaceContainer = c.surface, surfaceContainerHigh = c.raised, outline = c.border, outlineVariant = c.border, error = c.err,
            secondaryContainer = c.raised, onSecondaryContainer = c.fg,
        )
    } else {
        lightColorScheme(
            primary = c.accent, onPrimary = Color.White, primaryContainer = c.accent, onPrimaryContainer = Color.White,
            background = c.bg, onBackground = c.fg, surface = c.bg, onSurface = c.fg, surfaceVariant = c.surface, onSurfaceVariant = c.fgMuted,
            surfaceContainer = c.surface, surfaceContainerHigh = c.raised, outline = c.border, outlineVariant = c.border, error = c.err,
            secondaryContainer = c.surface, onSecondaryContainer = c.fg,
        )
    }
    CompositionLocalProvider(LocalAv provides c) { MaterialTheme(colorScheme = scheme, typography = typography, content = content) }
}

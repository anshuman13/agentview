package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

val LocalAv = staticCompositionLocalOf { DarkColors }
val av: AvColors @Composable get() = LocalAv.current

private val typography = Typography(
    displayLarge = Type.largeTitle, displayMedium = Type.display, displaySmall = Type.title,
    headlineLarge = Type.largeTitle, headlineMedium = Type.display, headlineSmall = Type.title,
    titleLarge = Type.title, titleMedium = Type.headline, titleSmall = Type.headline,
    bodyLarge = Type.body, bodyMedium = Type.meta, bodySmall = Type.caption,
    labelLarge = Type.callout, labelMedium = Type.label, labelSmall = Type.label,
)

@Composable
fun AgentViewTheme(theme: String = "", content: @Composable () -> Unit) {
    val dark = when (theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val c = if (dark) DarkColors else LightColors
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val scheme = base.copy(
        primary = c.accent, onPrimary = c.onAccent, primaryContainer = c.primaryContainer, onPrimaryContainer = c.onPrimaryContainer,
        secondary = c.fgMuted, onSecondary = c.bg, secondaryContainer = c.accentSoft, onSecondaryContainer = c.onSecondaryContainer,
        tertiary = c.agent, onTertiary = c.onAgent, tertiaryContainer = c.agentContainer, onTertiaryContainer = c.onAgentContainer,
        error = c.err, onError = c.onErr, errorContainer = c.errContainer, onErrorContainer = c.onErrContainer,
        background = c.bg, onBackground = c.fg, surface = c.bg, onSurface = c.fg, surfaceVariant = c.sunken, onSurfaceVariant = c.fgMuted,
        surfaceContainerLowest = c.containerLowest, surfaceContainerLow = c.containerLow, surfaceContainer = c.surface,
        surfaceContainerHigh = c.raised, surfaceContainerHighest = c.sunken, surfaceBright = c.raised, surfaceDim = c.bg,
        inverseSurface = c.inverseSurface, inverseOnSurface = c.inverseOnSurface, inversePrimary = c.inversePrimary,
        outline = c.borderStrong, outlineVariant = c.border, scrim = c.scrimStrong, surfaceTint = Color.Transparent,
    )
    val selection = TextSelectionColors(handleColor = c.accent, backgroundColor = c.accentSoft)
    CompositionLocalProvider(LocalAv provides c, LocalTextSelectionColors provides selection) {
        MaterialTheme(colorScheme = scheme, typography = typography, content = content)
    }
}

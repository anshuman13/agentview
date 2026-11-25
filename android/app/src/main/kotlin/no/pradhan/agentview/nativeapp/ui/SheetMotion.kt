@file:Suppress("INVISIBLE_MEMBER", "INVISIBLE_REFERENCE")

package no.pradhan.agentview.nativeapp.ui

import android.provider.Settings
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

// Shared sheet motion (web .ui-motion): ModalBottomSheet takes its slide and scrim fade from the theme's MotionScheme,
// which material3 1.4 keeps internal, hence the suppression. Animator scale 0 makes it instant.
private class TokenMotion(private val still: Boolean) : MotionScheme {
    private fun <T> spec(): FiniteAnimationSpec<T> = if (still) snap() else tween(Tokens.motionDuration, easing = Tokens.motionEaseIn)
    override fun <T> defaultSpatialSpec() = spec<T>()
    override fun <T> fastSpatialSpec() = spec<T>()
    override fun <T> slowSpatialSpec() = spec<T>()
    override fun <T> defaultEffectsSpec() = spec<T>()
    override fun <T> fastEffectsSpec() = spec<T>()
    override fun <T> slowEffectsSpec() = spec<T>()
}

// True when the animator duration scale is 0: token motion is then instant.
@Composable
internal fun motionOff(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

// Runs `sheet` under the token motion; `keep` puts the app's motion back for the sheet's content.
@Composable
internal fun SheetMotion(sheet: @Composable (keep: @Composable (@Composable () -> Unit) -> Unit) -> Unit) {
    val m = MaterialTheme
    val colors = m.colorScheme
    val shapes = m.shapes
    val type = m.typography
    val app = m.motionScheme
    val still = motionOff()
    MaterialTheme(colors, remember(still) { TokenMotion(still) }, shapes, type) {
        sheet { inner -> MaterialTheme(colors, app, shapes, type, inner) }
    }
}

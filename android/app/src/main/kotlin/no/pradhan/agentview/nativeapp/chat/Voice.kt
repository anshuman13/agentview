package no.pradhan.agentview.nativeapp.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av

// Writes spoken text into a field at the caret and keeps replacing its own partial text until it is final (web chat/Voice.tsx useDictation).
class Dictation {
    private class Run(val pre: String, val post: String, var wrote: String)

    private var run: Run? = null
    private var edited = false

    // The field's new text and caret, or null when the user edited the field since the last partial result.
    fun apply(current: String, caret: Int, spoken: String, final: Boolean): Pair<String, Int>? {
        val r = run
        if (r != null && current != r.wrote) edited = true
        if (edited) {
            if (final) reset()
            return null
        }
        val at = caret.coerceIn(0, current.length)
        val pre = r?.pre ?: current.substring(0, at)
        val post = r?.post ?: current.substring(at)
        val say = if (spoken.isNotEmpty() && pre.isNotEmpty() && !pre.last().isWhitespace()) " $spoken" else spoken
        val tail = if (say.isNotEmpty() && post.isNotEmpty() && !post.first().isWhitespace()) " " else ""
        val text = pre + say + tail + post
        val next = pre.length + say.length
        if (final) reset() else run = (r ?: Run(pre, post, "")).also { it.wrote = text }
        return text to next
    }

    private fun reset() { run = null; edited = false }
}

fun speechError(code: Int): String? = when (code) {
    SpeechRecognizer.ERROR_CLIENT -> null
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone blocked. Allow it in the app settings"
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech heard"
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "Speech service unreachable. Check the connection"
    SpeechRecognizer.ERROR_AUDIO -> "The microphone could not record"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The microphone is in use by another app"
    SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "Too many voice requests. Try again in a moment"
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "Speech recognition does not support this language yet"
    else -> "Voice input failed"
}

// onRmsChanged gives roughly -2 dB for silence to 10 dB for loud speech; 0 to 1 for the listening ring.
fun rmsLevel(db: Float): Float = ((db + 2f) / 12f).coerceIn(0f, 1f)

internal fun Bundle?.best() = this?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()

internal fun dictationIntent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)

internal fun listener(onPartial: (String) -> Unit, onResult: (String) -> Unit, onError: (Int) -> Unit, onLevel: (Float) -> Unit = {}) = object : RecognitionListener {
    override fun onPartialResults(b: Bundle?) { b.best().takeIf { it.isNotEmpty() }?.let(onPartial) }
    override fun onResults(b: Bundle?) = onResult(b.best())
    override fun onError(error: Int) = onError(error)
    override fun onReadyForSpeech(p: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(v: Float) = onLevel(rmsLevel(v))
    override fun onBufferReceived(b: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(t: Int, p: Bundle?) {}
}

// Tap to dictate and tap again to stop. The mic permission is asked on first use. While listening a ring behind the mic follows the voice level.
@Composable
fun VoiceButton(onText: (String, Boolean) -> Unit, onNotice: (String) -> Unit) {
    val ctx = LocalContext.current
    var listening by remember { mutableStateOf(false) }
    var level by remember { mutableFloatStateOf(0f) }
    val text by rememberUpdatedState(onText)
    val notice by rememberUpdatedState(onNotice)
    // One recognizer for the button's lifetime: destroying one while the next binds drops the new session with no callback.
    val rec = remember { arrayOfNulls<SpeechRecognizer>(1) }
    val session = remember { intArrayOf(0) }
    val pending = remember { arrayOf("") }

    fun flush() {
        session[0]++
        if (pending[0].isNotEmpty()) text(pending[0], true)
        pending[0] = ""
        listening = false
        level = 0f
    }

    fun start() {
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) { notice("Speech recognition is not available on this device"); return }
        val r = rec[0] ?: SpeechRecognizer.createSpeechRecognizer(ctx).also { rec[0] = it }
        val id = ++session[0]
        r.setRecognitionListener(listener(
            onPartial = { if (session[0] == id) { pending[0] = it; text(it, false) } },
            onResult = { if (session[0] == id) { if (it.isNotEmpty()) pending[0] = it; flush() } },
            onError = { if (session[0] == id) { if (pending[0].isEmpty()) notice(speechError(it) ?: "Voice input stopped. Tap the mic to try again"); flush() } },
            onLevel = { if (session[0] == id) level = it },
        ))
        pending[0] = ""
        listening = true
        r.startListening(dictationIntent())
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) start() else notice("Microphone blocked. Allow it in the app settings")
    }
    DisposableEffect(Unit) { onDispose { rec[0]?.destroy(); rec[0] = null } }

    Box(contentAlignment = Alignment.Center) {
        if (listening) ListeningRing(level)
        IconBtn(if (listening) "mic-filled" else "mic", if (listening) "Stop dictation" else "Dictate", {
            when {
                listening -> rec[0]?.stopListening()
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> start()
                else -> permission.launch(Manifest.permission.RECORD_AUDIO)
            }
        }, on = listening)
    }
}

// A soft accent circle that breathes while waiting and grows with the voice level (0 to 1); still when animations are off.
@Composable
fun ListeningRing(level: Float, size: Dp = Tokens.controlMd) {
    val resolver = LocalContext.current.contentResolver
    val motion = remember(resolver) { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f }
    val breath = if (motion) rememberInfiniteTransition(label = "listen").animateFloat(0.85f, 1.15f, infiniteRepeatable(tween(Tokens.dur * 5), RepeatMode.Reverse), label = "breath").value else 1f
    val voice by animateFloatAsState(if (motion) level else 0f, tween(Tokens.durFast), label = "level")
    val c = av
    Box(Modifier.size(size).graphicsLayer { val s = breath + voice * 0.45f; scaleX = s; scaleY = s }.background(c.accentSoft, CircleShape))
}

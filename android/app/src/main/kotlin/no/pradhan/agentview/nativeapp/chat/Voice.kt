package no.pradhan.agentview.nativeapp.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import no.pradhan.agentview.nativeapp.ui.AvIcon
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

// How long a stop waits for the recognizer's last result before it cancels the session.
const val STOP_WAIT_MS = 2000L

// The longest one dictation listens for.
const val SESSION_MS = 10 * 60_000L

// onRmsChanged gives roughly -2 dB for silence to 10 dB for loud speech; 0 to 1 for the listening ring.
fun rmsLevel(db: Float): Float = ((db + 2f) / 12f).coerceIn(0f, 1f)

internal fun Bundle?.best() = this?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()

// continuous on Android 13+ asks for a segmented session: each pause closes a segment and the session runs until stopListening
// (or SESSION_MS). A recognizer that does not support it ends at the first pause with onResults, as before.
internal fun dictationIntent(continuous: Boolean = false) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
    .apply {
        if (continuous && Build.VERSION.SDK_INT >= 33) {
            putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, SESSION_MS)
        }
    }

internal fun listener(
    onPartial: (String) -> Unit,
    onResult: (String) -> Unit,
    onError: (Int) -> Unit,
    onLevel: (Float) -> Unit = {},
    onSegment: (String) -> Unit = {},
    onSessionEnd: () -> Unit = {},
) = object : RecognitionListener {
    override fun onPartialResults(b: Bundle?) { b.best().takeIf { it.isNotEmpty() }?.let(onPartial) }
    override fun onResults(b: Bundle?) = onResult(b.best())
    override fun onSegmentResults(b: Bundle) = onSegment(b.best())
    override fun onEndOfSegmentedSession() = onSessionEnd()
    override fun onError(error: Int) = onError(error)
    override fun onReadyForSpeech(p: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(v: Float) = onLevel(rmsLevel(v))
    override fun onBufferReceived(b: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(t: Int, p: Bundle?) {}
}

// Tap to dictate and tap again to stop; on Android 13+ it keeps listening through pauses until then, on-device when the phone has the language.
// A second tap while it is stopping, or a stop that hears nothing back in STOP_WAIT_MS, cancels it so the mic can always start again. The mic permission is asked on first use. While listening a ring behind the mic follows the voice level.
// With onSubmit it is the round Talk button: a hold ends on release, and when the dictation ends with words heard onSubmit sends them, with none it says so.
@Composable
fun VoiceButton(onText: (String, Boolean) -> Unit, onNotice: (String) -> Unit, onSubmit: (() -> Unit)? = null, onListening: (Boolean) -> Unit = {}) {
    val ctx = LocalContext.current
    var listening by remember { mutableStateOf(false) }
    var level by remember { mutableFloatStateOf(0f) }
    val text by rememberUpdatedState(onText)
    val notice by rememberUpdatedState(onNotice)
    val submit by rememberUpdatedState(onSubmit)
    val listeningNow by rememberUpdatedState(onListening)
    // One recognizer for the button's lifetime: destroying one while the next binds drops the new session with no callback.
    val rec = remember { arrayOfNulls<SpeechRecognizer>(1) }
    val session = remember { intArrayOf(0) }
    val heard = remember { arrayOf(Heard()) }
    val stopping = remember { booleanArrayOf(false) }
    val onDevice = remember { booleanArrayOf(Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)) }
    val main = remember { Handler(Looper.getMainLooper()) }

    fun recognizer() = rec[0] ?: (if (onDevice[0] && Build.VERSION.SDK_INT >= 33) SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx) else SpeechRecognizer.createSpeechRecognizer(ctx)).also { rec[0] = it }
    fun drop() { rec[0]?.destroy(); rec[0] = null }

    fun flush(failed: Boolean = false) {
        session[0]++
        stopping[0] = false
        val h = heard[0]
        val last = h.segment("")
        if (last.isNotEmpty()) text(last, true)
        val all = h.text
        listening = false
        level = 0f
        submit?.let { go -> if (all.isNotEmpty()) go() else if (!failed) notice("No speech heard") }
    }

    fun start() {
        if (!onDevice[0] && !SpeechRecognizer.isRecognitionAvailable(ctx)) { notice("Speech recognition is not available on this device"); return }
        val r = recognizer()
        val id = ++session[0]
        val h = Heard().also { heard[0] = it }
        fun close(spoken: String) { val seg = h.segment(spoken); if (seg.isNotEmpty()) text(seg, true) }
        r.setRecognitionListener(listener(
            onPartial = { if (session[0] == id) { h.partial(it); text(it, false) } },
            onSegment = { if (session[0] == id) close(it) },
            onResult = { if (session[0] == id) { close(it); flush() } },
            onSessionEnd = { if (session[0] == id) flush() },
            onError = { code ->
                if (session[0] == id) {
                    val language = code == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || code == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE
                    if (language && onDevice[0] && h.text.isEmpty()) {
                        // Create the network recognizer before destroying the on-device one: destroying first drops the new session.
                        onDevice[0] = false
                        session[0]++
                        val old = rec[0]
                        rec[0] = null
                        start()
                        old?.destroy()
                    }
                    else {
                        if (code == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || code == SpeechRecognizer.ERROR_CLIENT || code == SpeechRecognizer.ERROR_SERVER_DISCONNECTED) drop()
                        val quiet = stopping[0] || h.text.isNotEmpty()
                        if (!quiet) notice(speechError(code) ?: "Voice input stopped. Tap the mic to try again")
                        flush(failed = !quiet)
                    }
                }
            },
            onLevel = { if (session[0] == id) level = it },
        ))
        stopping[0] = false
        listening = true
        r.startListening(dictationIntent(continuous = true))
    }

    fun stop() {
        if (stopping[0]) { rec[0]?.cancel(); flush(); return }
        stopping[0] = true
        rec[0]?.stopListening()
        val id = session[0]
        // No answer to the stop: the recognizer is stuck, so a fresh one serves the next tap.
        main.postDelayed({ if (session[0] == id) { rec[0]?.cancel(); drop(); flush() } }, STOP_WAIT_MS)
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) start() else notice("Microphone blocked. Allow it in the app settings")
    }
    DisposableEffect(Unit) { onDispose { session[0]++; main.removeCallbacksAndMessages(null); rec[0]?.destroy(); rec[0] = null } }
    LaunchedEffect(listening) { listeningNow(listening) }
    val toggle = {
        when {
            listening -> stop()
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> start()
            else -> permission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    val toggleNow by rememberUpdatedState(toggle)
    val listeningRef by rememberUpdatedState(listening)

    Box(contentAlignment = Alignment.Center) {
        if (listening) ListeningRing(level)
        if (onSubmit == null) IconBtn(if (listening) "mic-filled" else "mic", if (listening) "Stop dictation" else "Dictate", { toggle() }, on = listening)
        else {
            val label = if (listening) "Stop and send" else "Talk"
            Box(
                Modifier.size(Tokens.touch).semantics { contentDescription = label; onClick(label) { toggleNow(); true } }.pointerInput(Unit) {
                    detectTapGestures(onPress = {
                        val started = !listeningRef
                        val at = SystemClock.uptimeMillis()
                        toggleNow()
                        if (tryAwaitRelease() && started && SystemClock.uptimeMillis() - at > HOLD_MS && listeningRef) toggleNow()
                    })
                },
                contentAlignment = Alignment.Center,
            ) {
                RoundFace { AvIcon(if (listening) "debug-stop" else "unmute", null, Tokens.iconLg, tint = av.bg) }
            }
        }
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

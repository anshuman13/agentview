package no.pradhan.agentview.nativeapp.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.codex.edited
import no.pradhan.agentview.nativeapp.net.permission
import no.pradhan.agentview.nativeapp.net.post
import no.pradhan.agentview.nativeapp.ui.IconBtn

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
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> "Speech service unreachable"
    SpeechRecognizer.ERROR_AUDIO -> "No microphone found"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognition is busy"
    else -> "Voice input failed: $code"
}

internal fun Bundle?.best() = this?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()

internal fun dictationIntent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)

internal fun listener(onPartial: (String) -> Unit, onResult: (String) -> Unit, onError: (Int) -> Unit) = object : RecognitionListener {
    override fun onPartialResults(b: Bundle?) { b.best().takeIf { it.isNotEmpty() }?.let(onPartial) }
    override fun onResults(b: Bundle?) = onResult(b.best())
    override fun onError(error: Int) = onError(error)
    override fun onReadyForSpeech(p: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(v: Float) {}
    override fun onBufferReceived(b: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(t: Int, p: Bundle?) {}
}

// Tap to dictate and tap again to stop. The mic permission is asked on first use.
@Composable
fun VoiceButton(onText: (String, Boolean) -> Unit, onNotice: (String) -> Unit) {
    val ctx = LocalContext.current
    var listening by remember { mutableStateOf(false) }
    val text by rememberUpdatedState(onText)
    val notice by rememberUpdatedState(onNotice)
    val rec = remember { arrayOfNulls<SpeechRecognizer>(1) }
    val pending = remember { arrayOf("") }

    fun flush() {
        if (pending[0].isNotEmpty()) text(pending[0], true)
        pending[0] = ""
        listening = false
    }

    fun start() {
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) { notice("Speech recognition is not available on this device"); return }
        val r = SpeechRecognizer.createSpeechRecognizer(ctx)
        r.setRecognitionListener(listener(
            onPartial = { pending[0] = it; text(it, false) },
            onResult = { if (it.isNotEmpty()) pending[0] = it; flush() },
            onError = { speechError(it)?.let(notice); flush() },
        ))
        rec[0]?.destroy()
        rec[0] = r
        pending[0] = ""
        listening = true
        r.startListening(dictationIntent())
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) start() else notice("Microphone blocked. Allow it in the app settings")
    }
    DisposableEffect(Unit) { onDispose { rec[0]?.destroy(); rec[0] = null } }

    IconBtn(if (listening) "mic-filled" else "mic", if (listening) "Stop dictation" else "Dictate", {
        when {
            listening -> rec[0]?.stopListening()
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> start()
            else -> permission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }, on = listening)
}

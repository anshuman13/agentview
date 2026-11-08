package no.pradhan.agentview.nativeapp

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

// Speech in, the Codex ask path for the answer, speech out. It only reads: nothing is sent to other chats.
class VoiceMode(private val ctx: Context, private val hub: Hub, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow<VoiceState?>(null)
    val state: StateFlow<VoiceState?> = _state
    private val main = Handler(Looper.getMainLooper())
    private var rec: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var chunks = emptyList<String>()
    @Volatile private var at = 0
    private var job: Job? = null

    fun start() {
        cancel()
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) { fail("Speech recognition is not available on this device"); return }
        if (hub.readOnly) { fail("Read-only mode, nothing was asked"); return }
        _state.value = VoiceState(VoicePhase.Listening)
        val r = SpeechRecognizer.createSpeechRecognizer(ctx)
        rec = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(b: Bundle?) { b.best().takeIf { it.isNotEmpty() }?.let { _state.value = VoiceState(VoicePhase.Listening, it) } }
            override fun onResults(b: Bundle?) {
                val q = b.best()
                if (q.isEmpty()) fail("No speech heard") else ask(q)
            }
            override fun onError(error: Int) { speechError(error)?.let { fail(it) } }
            override fun onReadyForSpeech(p: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(t: Int, p: Bundle?) {}
        })
        r.startListening(dictationIntent())
    }

    private fun fail(message: String) { _state.value = VoiceState(VoicePhase.Failed, _state.value?.heard.orEmpty(), error = message) }

    private fun ask(question: String) {
        _state.value = VoiceState(VoicePhase.Thinking, question)
        job = scope.launch {
            hub.askAnswer(question, hub.codexProfile).fold({ speak(question, it) }, { fail(it.message ?: "No answer came back") })
        }
    }

    private fun speak(question: String, answer: String) {
        chunks = speechChunks(spokenText(answer))
        at = 0
        _state.value = VoiceState(VoicePhase.Speaking, question, answer)
        val engine = tts
        if (engine != null) { engine.setOnUtteranceProgressListener(progress(question, answer)); say(engine, 0) }
        else tts = TextToSpeech(ctx) { status ->
            main.post {
                val e = tts
                if (status != TextToSpeech.SUCCESS || e == null) { _state.value = VoiceState(VoicePhase.Done, question, answer); hub.notice.value = "Speech output is not available" }
                else if (_state.value?.phase == VoicePhase.Speaking) { e.setOnUtteranceProgressListener(progress(question, answer)); say(e, 0) }
            }
        }
    }

    private fun progress(question: String, answer: String) = object : UtteranceProgressListener() {
        override fun onStart(id: String?) { id?.toIntOrNull()?.let { at = it } }
        override fun onDone(id: String?) { if (id?.toIntOrNull() == chunks.lastIndex) main.post { if (_state.value?.phase == VoicePhase.Speaking) _state.value = VoiceState(VoicePhase.Done, question, answer) } }
        @Deprecated("Deprecated in Java") override fun onError(id: String?) { main.post { _state.value = VoiceState(VoicePhase.Done, question, answer) } }
    }

    private fun say(engine: TextToSpeech, from: Int) {
        if (chunks.isEmpty()) { _state.value = _state.value?.copy(phase = VoicePhase.Done); return }
        for (i in from until chunks.size) engine.speak(chunks[i], if (i == from) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null, "$i")
    }

    fun pause() {
        val s = _state.value ?: return
        if (s.phase != VoicePhase.Speaking) return
        tts?.stop()
        _state.value = s.copy(phase = VoicePhase.Paused)
    }

    fun resume() {
        val s = _state.value ?: return
        val engine = tts ?: return
        if (s.phase != VoicePhase.Paused) return
        _state.value = s.copy(phase = VoicePhase.Speaking)
        say(engine, at)
    }

    fun cancel() {
        job?.cancel()
        job = null
        rec?.destroy()
        rec = null
        tts?.stop()
        _state.value = null
    }

    fun release() {
        cancel()
        tts?.shutdown()
        tts = null
    }
}

// Starts voice mode when Sessions asks for it and shows the floating panel; the mic permission is asked on first use.
@Composable
fun VoiceHost(hub: Hub, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val voice = remember { VoiceMode(ctx, hub, scope) }
    val state by voice.state.collectAsState()
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) voice.start() else hub.notice.value = "Microphone blocked. Allow it in the app settings"
    }
    DisposableEffect(Unit) { onDispose { voice.release() } }
    LaunchedEffect(Unit) {
        hub.voiceRequest.collect {
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) voice.start()
            else permission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    state?.let { s ->
        Box(modifier.fillMaxSize().navigationBarsPadding().padding(bottom = Tokens.fabClear), contentAlignment = Alignment.BottomCenter) {
            VoicePanel(s, voice::pause, voice::resume, voice::cancel)
        }
    }
}

@Composable
fun VoicePanel(s: VoiceState, onPause: () -> Unit, onResume: () -> Unit, onCancel: () -> Unit) {
    val title = when (s.phase) {
        VoicePhase.Listening -> "Listening"
        VoicePhase.Thinking -> "Thinking"
        VoicePhase.Speaking -> "Speaking"
        VoicePhase.Paused -> "Paused"
        VoicePhase.Done -> "Answer"
        VoicePhase.Failed -> "Voice"
    }
    Panel(Modifier.padding(horizontal = Tokens.listPad).shadow(Tokens.elev2, RoundedCornerShape(Tokens.shapeLg))) {
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
            AvIcon(if (s.phase == VoicePhase.Listening) "mic" else "sparkle", null, Tokens.iconMd, tint = av.accentText)
            Text(title, style = Type.headline, color = av.fg)
        }
        if (s.heard.isNotEmpty()) Text(s.heard, style = Type.subheadline, color = av.fgMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (s.error.isNotEmpty()) Text(s.error, style = Type.body, color = av.err)
        if (s.answer.isNotEmpty()) Text(s.answer, style = Type.body, color = av.fg, maxLines = 6, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
            if (s.phase == VoicePhase.Speaking) Button("Pause", onPause, icon = "debug-pause")
            if (s.phase == VoicePhase.Paused) Button("Resume", onResume, icon = "play")
            Button(if (s.phase == VoicePhase.Done || s.phase == VoicePhase.Failed) "Close" else "Cancel", onCancel, variant = ButtonVariant.Tinted)
        }
    }
}

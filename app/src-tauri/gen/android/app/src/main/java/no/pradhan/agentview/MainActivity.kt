package no.pradhan.agentview

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File
import java.util.Locale

private const val CHANNEL = "agentview"
private const val NOTIFICATION_ID = "agentview.notification"

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var recognizer: SpeechRecognizer? = null
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private val ttsQueue = mutableListOf<(TextToSpeech) -> Unit>()
  private val prefs by lazy { getSharedPreferences("shell", MODE_PRIVATE) }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.setDownloadListener { url, _, _, _, _ -> openExternal(url) }
    webView.addJavascriptInterface(Shell(), "AgentViewShell")
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      val script = resources.openRawResource(R.raw.shell).bufferedReader().use { it.readText() }
      WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("*"))
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val id = intent.getIntExtra(NOTIFICATION_ID, -1)
    if (id >= 0) emit("notification-click", JSONObject().put("id", id))
  }

  override fun onDestroy() {
    recognizer?.destroy()
    tts?.shutdown()
    super.onDestroy()
  }

  private fun emit(type: String, data: JSONObject) {
    val js = "window.__agentview&&__agentview.emit(${JSONObject.quote(type)},$data)"
    runOnUiThread { webView?.evaluateJavascript(js, null) }
  }

  private fun toast(text: String) = runOnUiThread { Toast.makeText(this, text, Toast.LENGTH_SHORT).show() }

  private fun openExternal(url: String) {
    try {
      val parsed = if (url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME) else null
      val app = parsed?.takeIf { it.data?.toString().isNullOrEmpty() }?.`package`?.let { packageManager.getLaunchIntentForPackage(it) }
      if (app != null) return startActivity(app)
      val intent = if (parsed != null) {
        parsed.apply { component = null; selector = null }
      } else {
        Intent(Intent.ACTION_VIEW, Uri.parse(url))
      }
      startActivity(intent.addCategory(Intent.CATEGORY_BROWSABLE))
    } catch (_: Exception) {
      toast("No app can open $url")
    }
  }

  private fun granted(permission: String) =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  private fun withPermission(permission: String, denied: () -> Unit, block: () -> Unit) {
    if (granted(permission)) block() else requestPermissions(arrayOf(permission)) { if (it == true) block() else denied() }
  }

  private fun notificationState() = when {
    NotificationManagerCompat.from(this).areNotificationsEnabled() -> "granted"
    prefs.getBoolean("notifyAsked", false) -> "denied"
    else -> "default"
  }

  private fun showNotification(id: Int, title: String, body: String, tag: String) {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "AgentView", NotificationManager.IMPORTANCE_HIGH))
    }
    val intent = Intent(this, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(NOTIFICATION_ID, id)
    val pending = PendingIntent.getActivity(this, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(pending)
      .build()
    try {
      if (tag.isEmpty()) manager.notify(id, notification) else manager.notify(tag, 0, notification)
    } catch (_: SecurityException) {
    }
  }

  private fun startListening(lang: String, interim: Boolean) {
    if (!SpeechRecognizer.isRecognitionAvailable(this)) return speechDone("service-not-allowed")
    recognizer?.destroy()
    val r = SpeechRecognizer.createSpeechRecognizer(this)
    recognizer = r
    r.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) = emit("speech-start", JSONObject())
      override fun onBeginningOfSpeech() {}
      override fun onRmsChanged(rmsdB: Float) {}
      override fun onBufferReceived(buffer: ByteArray?) {}
      override fun onEndOfSpeech() {}
      override fun onEvent(eventType: Int, params: Bundle?) {}
      override fun onPartialResults(partialResults: Bundle) = speechResult(partialResults, false)
      override fun onResults(results: Bundle) {
        speechResult(results, true)
        speechDone(null)
      }
      override fun onError(error: Int) = speechDone(
        when (error) {
          SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> "network"
          SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
          SpeechRecognizer.ERROR_CLIENT -> "aborted"
          SpeechRecognizer.ERROR_SPEECH_TIMEOUT, SpeechRecognizer.ERROR_NO_MATCH -> "no-speech"
          SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
          12, 13 -> "language-not-supported"
          else -> "speech-error-$error"
        }
      )
    })
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, interim)
    if (lang.isNotEmpty()) intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
    r.startListening(intent)
  }

  private fun speechResult(bundle: Bundle, final: Boolean) {
    val text = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
    if (!text.isNullOrEmpty()) emit("speech", JSONObject().put("text", text).put("final", final))
  }

  private fun speechDone(error: String?) {
    recognizer?.destroy()
    recognizer = null
    emit("speech-end", JSONObject().put("error", error ?: JSONObject.NULL))
  }

  private fun withTts(block: (TextToSpeech) -> Unit) {
    val engine = tts
    if (engine != null && ttsReady) return block(engine)
    ttsQueue.add(block)
    if (engine != null) return
    tts = TextToSpeech(this) { status ->
      runOnUiThread {
        val t = tts ?: return@runOnUiThread
        ttsReady = status == TextToSpeech.SUCCESS
        if (!ttsReady) {
          tts = null
          ttsQueue.clear()
          emit("tts-unavailable", JSONObject())
          return@runOnUiThread
        }
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String) = ttsEvent(utteranceId, "start")
          override fun onDone(utteranceId: String) = ttsEvent(utteranceId, "end")
          override fun onStop(utteranceId: String, interrupted: Boolean) = ttsEvent(utteranceId, "stop")
          @Deprecated("Deprecated in Java")
          override fun onError(utteranceId: String) = ttsEvent(utteranceId, "error")
        })
        ttsQueue.forEach { it(t) }
        ttsQueue.clear()
      }
    }
  }

  private fun ttsEvent(utteranceId: String, type: String) {
    val (id, index, last) = utteranceId.split("|")
    val send = when (type) {
      "start" -> index == "0"
      "end" -> index == last
      else -> true
    }
    if (send) emit("tts", JSONObject().put("id", id).put("type", if (type == "stop") "end" else type))
  }

  private fun chunks(text: String, size: Int): List<String> {
    val out = mutableListOf<String>()
    var rest = text
    while (rest.length > size) {
      val cut = rest.lastIndexOfAny(charArrayOf('.', '!', '?', '\n'), size).takeIf { it > size / 2 } ?: size
      out.add(rest.substring(0, cut + 1))
      rest = rest.substring(cut + 1)
    }
    out.add(rest)
    return out
  }

  private fun writeDownload(name: String, mime: String, bytes: ByteArray) {
    val type = mime.ifEmpty { "application/octet-stream" }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, name)
        put(MediaStore.Downloads.MIME_TYPE, type)
      }
      val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("insert failed")
      contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("open failed")
    } else {
      File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name).writeBytes(bytes)
    }
  }

  inner class Shell {
    @JavascriptInterface
    fun features() = "open,save,clipboard,share,wakelock,notifications,speech,tts"

    @JavascriptInterface
    fun open(url: String) = runOnUiThread { openExternal(url) }

    @JavascriptInterface
    fun copy(text: String) = runOnUiThread {
      getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("AgentView", text))
    }

    @JavascriptInterface
    fun paste(): String {
      val clip = getSystemService(ClipboardManager::class.java).primaryClip ?: return ""
      return if (clip.itemCount > 0) clip.getItemAt(0).coerceToText(this@MainActivity).toString() else ""
    }

    @JavascriptInterface
    fun share(title: String, text: String, url: String) = runOnUiThread {
      val body = listOf(text, url).filter { it.isNotBlank() }.joinToString("\n")
      val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, body)
      if (title.isNotBlank()) send.putExtra(Intent.EXTRA_SUBJECT, title)
      startActivity(Intent.createChooser(send, title.ifBlank { null }))
    }

    @JavascriptInterface
    fun keepAwake(on: Boolean) = runOnUiThread {
      if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    @JavascriptInterface
    fun notificationPermission() = notificationState()

    @JavascriptInterface
    fun requestNotifications() = runOnUiThread {
      val reply = { emit("notify-permission", JSONObject().put("state", notificationState())) }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
        prefs.edit().putBoolean("notifyAsked", true).apply()
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) { reply() }
      } else {
        reply()
      }
    }

    @JavascriptInterface
    fun notify(id: Int, title: String, body: String, tag: String) = runOnUiThread { showNotification(id, title, body, tag) }

    @JavascriptInterface
    fun closeNotification(id: Int, tag: String) = runOnUiThread {
      val manager = getSystemService(NotificationManager::class.java)
      if (tag.isEmpty()) manager.cancel(id) else manager.cancel(tag, 0)
    }

    @JavascriptInterface
    fun listen(lang: String, interim: Boolean) = runOnUiThread {
      withPermission(Manifest.permission.RECORD_AUDIO, { speechDone("not-allowed") }) { startListening(lang, interim) }
    }

    @JavascriptInterface
    fun stopListening() = runOnUiThread { recognizer?.stopListening() }

    @JavascriptInterface
    fun abortListening() = runOnUiThread {
      if (recognizer != null) {
        recognizer?.cancel()
        speechDone("aborted")
      }
    }

    @JavascriptInterface
    fun speak(id: String, text: String, lang: String, rate: Float, pitch: Float) = runOnUiThread {
      withTts { t ->
        if (lang.isNotEmpty()) t.language = Locale.forLanguageTag(lang)
        t.setSpeechRate(rate)
        t.setPitch(pitch)
        val parts = chunks(text, TextToSpeech.getMaxSpeechInputLength() - 100)
        parts.forEachIndexed { i, part -> t.speak(part, TextToSpeech.QUEUE_ADD, null, "$id|$i|${parts.size - 1}") }
      }
    }

    @JavascriptInterface
    fun cancelSpeech() = runOnUiThread {
      ttsQueue.clear()
      tts?.stop()
    }

    @JavascriptInterface
    fun save(name: String, mime: String, base64: String) {
      val file = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "download" }
      try {
        writeDownload(file, mime, Base64.decode(base64, Base64.DEFAULT))
        toast("Saved $file to Downloads")
      } catch (_: Exception) {
        toast("Could not save $file")
      }
    }
  }
}

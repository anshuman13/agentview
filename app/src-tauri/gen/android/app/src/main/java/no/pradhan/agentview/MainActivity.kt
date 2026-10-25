package no.pradhan.agentview

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val CHANNEL = "agentview"
private const val KEY_ALIAS = "assistant-db-key"
private const val NOTIFICATION_ID = "agentview.notification"
private val MAC_URL = Regex("^http://([a-z0-9-]+\\.netbird\\.cloud|100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.\\d+\\.\\d+|localhost)(:\\d{1,5})?$", RegexOption.IGNORE_CASE)

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var recognizer: SpeechRecognizer? = null
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private val ttsQueue = mutableListOf<(TextToSpeech) -> Unit>()
  private val prefs by lazy { getSharedPreferences("shell", MODE_PRIVATE) }
  private val shared = mutableListOf<JSONObject>()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    collectShare(intent)
  }

  @Suppress("DEPRECATION")
  private fun collectShare(intent: Intent?) {
    val uris = when (intent?.action) {
      Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
      Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
      else -> return
    }
    Thread {
      for (uri in uris) {
        try {
          val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "shared"
          val bytes = contentResolver.openInputStream(uri)?.use { s ->
            val buf = ByteArray(20_000_001)
            var n = 0
            while (n < buf.size) { val r = s.read(buf, n, buf.size - n); if (r < 0) break; n += r }
            buf.copyOf(n)
          } ?: continue
          if (bytes.size > 20_000_000) { toast("$name is over 20 MB"); continue }
          val item = JSONObject().put("name", name).put("type", contentResolver.getType(uri) ?: "application/octet-stream").put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
          synchronized(shared) { shared.add(item) }
        } catch (_: Exception) {
          toast("Could not read a shared file")
        }
      }
      if (uris.isEmpty()) intent.getStringExtra(Intent.EXTRA_TEXT)?.let { text -> synchronized(shared) { shared.add(JSONObject().put("text", text)) } }
      runOnUiThread { webView?.evaluateJavascript("window.dispatchEvent(new Event('agentview:shared'))", null) }
    }.start()
    intent.action = null
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
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
    collectShare(intent)
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

  private fun assistantResult(key: String?, error: String?) {
    val detail = JSONObject().put(if (key != null) "key" else "error", key ?: error)
    val js = "window.dispatchEvent(new CustomEvent('assistant-key',{detail:$detail}))"
    runOnUiThread { webView?.evaluateJavascript(js, null) }
  }

  private fun keystoreKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setUserAuthenticationRequired(true)
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        else @Suppress("DEPRECATION") setUserAuthenticationValidityDurationSeconds(-1)
      }
      .build()
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
  }

  private fun unlockAssistant() {
    if (BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
      return assistantResult(null, "Set up a fingerprint on this phone first")
    }
    val wrapped = prefs.getString("assistantKey", null)?.split(":")
    val cipher = try {
      Cipher.getInstance("AES/GCM/NoPadding").also {
        if (wrapped == null) it.init(Cipher.ENCRYPT_MODE, keystoreKey())
        else it.init(Cipher.DECRYPT_MODE, keystoreKey(), GCMParameterSpec(128, Base64.decode(wrapped[0], Base64.NO_WRAP)))
      }
    } catch (e: Exception) {
      return assistantResult(null, "Unlock key unavailable: ${e.message}")
    }
    val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = assistantResult(null, errString.toString())
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        try {
          val c = result.cryptoObject!!.cipher!!
          val raw = if (wrapped == null) ByteArray(32).also { SecureRandom().nextBytes(it) } else c.doFinal(Base64.decode(wrapped[1], Base64.NO_WRAP))
          if (wrapped == null) {
            val blob = c.doFinal(raw)
            prefs.edit().putString("assistantKey", Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(blob, Base64.NO_WRAP)).apply()
          }
          assistantResult(raw.joinToString("") { "%02x".format(it) }, null)
        } catch (e: Exception) {
          assistantResult(null, "Could not unlock: ${e.message}")
        }
      }
    })
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle("Unlock Assistant")
      .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
      .setNegativeButtonText("Cancel")
      .build()
    prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
  }

  private fun toast(text: String) = runOnUiThread { Toast.makeText(this, text, Toast.LENGTH_SHORT).show() }

  private fun openExternal(url: String) {
    try {
      val intent = if (url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME) else Intent(Intent.ACTION_VIEW, Uri.parse(url))
      val app = intent.`package`?.takeIf { intent.data?.scheme == null }?.let(packageManager::getLaunchIntentForPackage)
      startActivity(app ?: intent.apply { component = null; selector = null }.addCategory(Intent.CATEGORY_BROWSABLE))
    } catch (_: Exception) {
      toast("No app can open $url")
    }
  }

  private fun granted(permission: String) =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  private fun showNotification(id: Int, title: String, body: String, tag: String) {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "AgentView", NotificationManager.IMPORTANCE_HIGH))
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
    if (tag.isEmpty()) manager.notify(id, notification) else manager.notify(tag, 0, notification)
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
      window.decorView.post {
        val t = tts ?: return@post
        ttsReady = status == TextToSpeech.SUCCESS
        if (!ttsReady) {
          tts = null
          ttsQueue.clear()
          emit("tts-unavailable", JSONObject())
          return@post
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
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, name)
      put(MediaStore.Downloads.MIME_TYPE, mime.ifEmpty { "application/octet-stream" })
    }
    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("insert failed")
    contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("open failed")
  }

  inner class Shell {
    @JavascriptInterface
    fun unlock() = runOnUiThread { unlockAssistant() }

    @JavascriptInterface
    fun takeShared(): String = synchronized(shared) { JSONArray(shared).toString().also { shared.clear() } }

    @JavascriptInterface
    fun remember(url: String, name: String) {
      if (!MAC_URL.matches(url) || name.length > 64) return
      val macs = JSONArray(macs())
      val rest = (0 until macs.length()).map { macs.getJSONObject(it) }.filter { it.optString("url") != url }
      prefs.edit().putString("macs", JSONArray(listOf(JSONObject().put("url", url).put("name", name)) + rest).toString()).apply()
    }

    @JavascriptInterface
    fun macs(): String = prefs.getString("macs", "[]") ?: "[]"

    @JavascriptInterface
    fun open(url: String) = runOnUiThread { openExternal(url) }

    @JavascriptInterface
    fun launch(pkg: String): Boolean {
      val intent = packageManager.getLaunchIntentForPackage(pkg) ?: return false
      runOnUiThread { startActivity(intent) }
      return true
    }

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
    fun notificationPermission() = when {
      NotificationManagerCompat.from(this@MainActivity).areNotificationsEnabled() -> "granted"
      prefs.getBoolean("notifyAsked", false) -> "denied"
      else -> "default"
    }

    @JavascriptInterface
    fun requestNotifications() = runOnUiThread {
      val reply = { emit("notify-permission", JSONObject().put("state", notificationPermission())) }
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
      if (granted(Manifest.permission.RECORD_AUDIO)) startListening(lang, interim)
      else requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO)) { if (it == true) startListening(lang, interim) else speechDone("not-allowed") }
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

package no.pradhan.agentview.nativeapp

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.util.UUID

// Same default as the Tauri phone app (web/src/app/api.ts MAC_URL).
const val DEFAULT_ORIGIN = "http://anshumans-macbook-pro.netbird.cloud:7777"

class Hub(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("agentview", 0)
    private val cid = UUID.randomUUID().toString()
    private val http = OkHttpClient()
    val store = ChatStore()

    val origin = MutableStateFlow(prefs.getString("origin", null) ?: DEFAULT_ORIGIN)
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected
    val notice = MutableStateFlow<String?>(null)

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private val stream = EventStream(
        viewModelScope,
        url = { last ->
            val chat = store.wanted
            "${origin.value}/api/events?cid=$cid" + (if (chat.isNotEmpty()) "&chat=${enc(chat)}" else "") + (if (last.isNotEmpty()) "&last=$last" else "")
        },
        onConnected = { _connected.value = it },
        onData = { data -> runCatching { parseMessage(data) }.onSuccess { store.handle(it) } },
    )

    fun connect() = stream.start()
    fun disconnect() = stream.stop()

    fun saveOrigin(value: String) {
        val v = value.trim().trimEnd('/').let { if (it.isEmpty() || "://" in it) it else "http://$it" }
        if (v.isEmpty()) return
        prefs.edit().putString("origin", v).apply()
        origin.value = v
        store.reset()
        stream.resetResume()
        stream.start()
    }

    fun open(id: String) {
        store.show(id)
        post(viewCmd(id), id)
    }

    fun close() = store.close()

    fun send(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        val chat = store.wanted
        val running = store.state.value.live.firstOrNull { it.id == chat }?.running == true
        post(promptCmd(t, running, UUID.randomUUID().toString()), chat)
    }

    private fun post(body: String, chat: String) {
        viewModelScope.launch(Dispatchers.IO) {
            val url = "${origin.value}/api/cmd?cid=$cid&chat=${enc(chat)}"
            val err = try {
                http.newCall(Request.Builder().url(url).post(body.toRequestBody("application/json".toMediaType())).build()).execute().use { if (it.isSuccessful) null else "Server said ${it.code}" }
            } catch (e: Exception) {
                "Not connected, that did not reach the server"
            }
            if (err != null) notice.value = err
        }
    }
}

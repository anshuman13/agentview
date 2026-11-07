package no.pradhan.agentview.nativeapp

import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

// A /ws connection that reconnects with the terminal backoff until closed or the server says the target is gone (4404).
// Messages arrive on OkHttp's thread; open, drop and gone are posted to the main thread.
class LiveSocket(
    private val client: OkHttpClient,
    private val url: String,
    private val onText: (String) -> Unit,
    private val onOpen: () -> Unit = {},
    private val onGone: () -> Unit = {},
    private val onDrop: () -> Unit = {},
) {
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var ws: WebSocket? = null
    @Volatile private var closed = false
    private var attempt = 0

    fun open() {
        if (closed) return
        ws = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                attempt = 0
                main.post { if (!closed) onOpen() }
            }
            override fun onMessage(webSocket: WebSocket, text: String) { if (!closed && webSocket === ws) onText(text) }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, null) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (webSocket !== ws) return
                if (termGone(code)) main.post { if (!closed) onGone() } else retry()
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { if (webSocket === ws) retry() }
        })
    }

    private fun retry() {
        if (closed) return
        main.post { if (!closed) onDrop() }
        main.postDelayed({ open() }, termDelay(attempt++))
    }

    fun send(text: String) = ws?.send(text) == true

    fun close() {
        closed = true
        main.removeCallbacksAndMessages(null)
        ws?.close(1000, null)
    }
}

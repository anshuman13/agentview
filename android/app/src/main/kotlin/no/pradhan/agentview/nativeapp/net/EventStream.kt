package no.pradhan.agentview.nativeapp.net

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.Request

val BACKOFF_SECONDS = listOf(1, 2, 4, 8, 15)
fun backoffMs(attempt: Int, random: () -> Double = Math::random) =
    (BACKOFF_SECONDS[minOf(attempt, BACKOFF_SECONDS.lastIndex)] * 1000L * (1 + (random() * 2 - 1) * 0.2)).toLong()

// Feeds SSE lines to `onData`: `data:` lines of an unnamed event; named events such as ping only mark the link as alive.
// An event's id is reported at its blank line, so a drop mid-event leaves the last applied id.
class SseParser(private val onId: (String) -> Unit, private val onData: (String) -> Unit) {
    private val data = StringBuilder()
    private var named = false
    private var id: String? = null

    fun line(l: String) {
        when {
            l.isEmpty() -> {
                if (data.isNotEmpty() && !named) onData(data.toString())
                id?.let(onId)
                data.clear()
                named = false
                id = null
            }
            l.startsWith("id:") -> id = l.substring(3).trim()
            l.startsWith("event:") -> named = true
            l.startsWith("data:") -> {
                if (data.isNotEmpty()) data.append('\n')
                data.append(l.substring(5).removePrefix(" "))
            }
        }
    }
}

// GET /api/events with 1, 2, 4, 8, 15 s backoff (20% jitter) after a drop; resumes from the last event id.
class EventStream(
    private val scope: CoroutineScope,
    private val url: (lastId: String) -> String,
    private val onConnected: (Boolean) -> Unit,
    private val onData: (String) -> Unit,
) {
    private val http = sharedHttp.newBuilder().readTimeout(45, TimeUnit.SECONDS).build()
    private var job: Job? = null
    @Volatile private var call: Call? = null
    private var lastId = ""
    @Volatile var lastSeen = 0L

    @Synchronized fun start() {
        stop()
        job = scope.launch(Dispatchers.IO) {
            var attempt = 0
            while (isActive) {
                try {
                    val c = http.newCall(Request.Builder().url(url(lastId)).header("accept", "text/event-stream").build())
                    call = c
                    c.execute().use { r ->
                        if (!r.isSuccessful) error("status ${r.code}")
                        attempt = 0
                        onConnected(true)
                        val parser = SseParser({ lastId = it }, onData)
                        val src = r.body.source()
                        while (isActive) {
                            val line = src.readUtf8Line() ?: break
                            lastSeen = System.currentTimeMillis()
                            parser.line(line)
                        }
                    }
                } catch (_: Exception) {
                }
                onConnected(false)
                if (!isActive) break
                delay(backoffMs(attempt++))
            }
        }
    }

    @Synchronized fun stop() {
        job?.cancel()
        call?.cancel()
        job = null
    }

    fun resetResume() { lastId = "" }
}

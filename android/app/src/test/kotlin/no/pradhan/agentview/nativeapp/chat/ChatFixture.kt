package no.pradhan.agentview.nativeapp.chat

import android.app.Application
import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import no.pradhan.agentview.nativeapp.app.AppState
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.ServerMessage
import no.pradhan.agentview.nativeapp.net.SessionInfo
import no.pradhan.agentview.nativeapp.ui.AgentViewTheme
import org.robolectric.RuntimeEnvironment

const val CHAT = "fx"
const val CWD = "/repo"
const val EDITED = "src/Greeting.kt"
const val FILE_TEXT = "fun greet(name: String) = \"Hello, \$name!\""

// A chat for the screen tests: a Hub on a local stand-in server (only /api/file answers), so nothing reaches the live server.
class ChatFixture {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { ex ->
            val body = if (ex.requestURI.path == "/api/file") """{"content":${JsonPrimitive(FILE_TEXT)},"original":${JsonPrimitive("fun greet() = \"Hello\"")}}""" else "{}"
            val bytes = body.toByteArray()
            ex.sendResponseHeaders(if (ex.requestURI.path == "/api/file") 200 else 404, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        start()
    }
    private val models = ViewModelStore()
    val hub: Hub

    init {
        val app = RuntimeEnvironment.getApplication() as Application
        app.getSharedPreferences("agentview", 0).edit().putString("origin", "http://127.0.0.1:${server.address.port}").commit()
        AppState.readOnly = true
        hub = ViewModelProvider.create(models, viewModelFactory { initializer { Hub(app, SavedStateHandle()) } })[Hub::class]
        hub.foreground = true
        hub._connected.value = true
    }

    fun show(events: List<ChatEvent>, running: Boolean = false, run: ChatRun? = null, draft: String = "") {
        if (draft.isNotEmpty()) hub.drafts.set(CHAT, draft)
        val store = hub.store
        store.handle(ServerMessage.Live(listOf(LiveChat(CHAT, "Add screen tests", CWD, running = running, sessionId = CHAT, provider = "claude"))))
        if (run != null) store.handle(ServerMessage.Runs(listOf(run)))
        store.show(CHAT)
        store.handle(ServerMessage.Init(CHAT, events, 0, SessionInfo(CHAT, CHAT, cwd = CWD, running = running, provider = "claude")))
    }

    fun close() {
        models.clear()
        server.stop(0)
        AppState.readOnly = false
    }
}

// ChatScreen with the Work screen a "Used N tools" tap opens, as the app's Shell routes it.
class ChatHost(private val hub: Hub) {
    var theme by mutableStateOf("light")
    var work by mutableStateOf<String?>(null)

    // Without ripples: one still fading when the image is taken differs from run to run.
    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    fun Content() = AgentViewTheme(theme) {
        CompositionLocalProvider(LocalIndication provides NoRipple, LocalRippleConfiguration provides null) {
            Surface {
                val turn = work
                if (turn != null) WorkScreen(hub, turn, { work = null }, {}) else ChatScreen(hub, {}, { work = it })
            }
        }
    }
}

private object NoRipple : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode = object : Modifier.Node() {}
    override fun equals(other: Any?) = other === this
    override fun hashCode() = 0
}

// Events at fixed offsets from now, so day dividers and reply times read the same on every run.
class Events {
    private val base = System.currentTimeMillis() - 30_000
    private var n = 0
    private fun at() = base + 1_000L * n++

    fun user(text: String) = ChatEvent("u$n", "user", text = text, at = at())
    fun say(text: String) = ChatEvent("a$n", "assistant", text = text, at = at())
    fun use(name: String, vararg input: Pair<String, Any>) = ChatEvent("t$n", "tool_use", name = name, input = obj(*input), at = at())
    fun result(of: ChatEvent, text: String = "ok") = ChatEvent("r$n", "tool_result", toolUseId = of.id, text = text, at = at())
    fun done(cost: Double) = ChatEvent("d$n", "result", costUsd = cost, at = at())
    fun status(done: String, next: List<String>, text: String) =
        use("mcp__agentview__set_status", "done" to done, "next" to JsonArray(next.map(::JsonPrimitive)), "text" to text)

    private fun obj(vararg kv: Pair<String, Any>) = JsonObject(kv.associate { (k, v) -> k to (v as? JsonArray ?: JsonPrimitive(v.toString())) })
}

private val CODE_REPLY = """
    Added the greeting with a name:

    ```kotlin
    fun greet(name: String) = "Hello, ${'$'}name!"
    ```

    The tests pass.
""".trimIndent()

// An edit of two lines added and one removed.
private fun Events.edit() = use("Edit", "file_path" to "$CWD/$EDITED", "old_string" to "fun greet() = \"Hello\"", "new_string" to "// Greets by name.\nfun greet(name: String) = \"Hello, \$name!\"")

// One finished turn: a reply with code after a read, an edit and a test run.
fun finishedTurn(e: Events = Events()): List<ChatEvent> {
    val out = mutableListOf(e.user("Make greet take a name"))
    val read = e.use("Read", "file_path" to "$CWD/$EDITED").also { out += it }
    out += e.result(read, "fun greet() = \"Hello\"")
    val edit = e.edit().also { out += it }
    out += e.result(edit)
    val test = e.use("Bash", "command" to "./gradlew test", "description" to "Run the unit tests").also { out += it }
    out += e.result(test, "BUILD SUCCESSFUL in 4s")
    out += e.say(CODE_REPLY)
    out += e.done(0.12)
    return out
}

// A turn still running after the finished one: two tasks done, a read and an edit done, a search without a result yet.
fun runningTurn(e: Events = Events()): List<ChatEvent> {
    val first = finishedTurn(e)
    val prompt = e.user("Now add screen tests")
    val s1 = e.status("Read the chat screen", listOf("Write the fixture", "Record the images"), "Reading the chat screen")
    val read = e.use("Read", "file_path" to "$CWD/$EDITED")
    val readDone = e.result(read)
    val edit = e.edit()
    val editDone = e.result(edit)
    val s2 = e.status("Write the fixture", listOf("Record the images"), "Writing the fixture")
    val grep = e.use("Grep", "pattern" to "greet", "path" to "$CWD/src")
    return first + listOf(prompt, s1, read, readDone, edit, editDone, s2, grep)
}

val BUILD_RUN = ChatRun("run1", kind = "build", chatId = CHAT, sessionId = CHAT, state = "running", progress = "1 of 3", task = "Add screen tests")

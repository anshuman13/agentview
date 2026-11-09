package no.pradhan.agentview.nativeapp.workspace

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.app.text
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.codex.split
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.write
import no.pradhan.agentview.nativeapp.sessions.state
import no.pradhan.agentview.nativeapp.ui.color

// A read view of a shell: enough of a VT100 to show prompts, output, colours and line edits.
// A colour is -1 for the default or 0..15 for the ANSI palette.
data class TermRun(val start: Int, val end: Int, val color: Int)
data class TermLine(val text: String, val runs: List<TermRun>)

class TermScreen(private val max: Int = 3000) {
    private val text = mutableListOf(StringBuilder())
    private val colors = mutableListOf(mutableListOf<Int>())
    private var row = 0
    private var col = 0
    private var top = 0
    private var color = -1
    private var pending = ""

    fun reset() {
        text.clear(); colors.clear(); text += StringBuilder(); colors += mutableListOf<Int>()
        row = 0; col = 0; top = 0; color = -1; pending = ""
    }

    private fun line(r: Int): StringBuilder {
        while (text.size <= r) { text += StringBuilder(); colors += mutableListOf<Int>() }
        return text[r]
    }

    private fun put(c: Char) {
        val l = line(row)
        val cs = colors[row]
        while (l.length < col) { l.append(' '); cs += -1 }
        if (col < l.length) { l.setCharAt(col, c); cs[col] = color } else { l.append(c); cs += color }
        col++
    }

    private fun eraseLine(from: Int, to: Int) {
        val l = line(row)
        val cs = colors[row]
        val end = minOf(to, l.length)
        if (from >= end) return
        if (end == l.length) { l.setLength(from); while (cs.size > from) cs.removeAt(cs.size - 1) }
        else for (i in from until end) { l.setCharAt(i, ' '); cs[i] = -1 }
    }

    private fun trim() {
        val over = text.size - max
        if (over <= 0) return
        repeat(over) { text.removeAt(0); colors.removeAt(0) }
        row = maxOf(0, row - over); top = maxOf(0, top - over)
    }

    private fun sgr(params: List<Int>) {
        var i = 0
        val ps = params.ifEmpty { listOf(0) }
        while (i < ps.size) {
            when (val p = ps[i]) {
                0, 39 -> color = -1
                in 30..37 -> color = p - 30
                in 90..97 -> color = p - 90 + 8
                38 -> {
                    if (ps.getOrNull(i + 1) == 5) { val n = ps.getOrNull(i + 2) ?: 0; color = if (n < 16) n else -1; i += 2 }
                    else if (ps.getOrNull(i + 1) == 2) { color = -1; i += 4 }
                }
                48 -> i += if (ps.getOrNull(i + 1) == 5) 2 else if (ps.getOrNull(i + 1) == 2) 4 else 0
            }
            i++
        }
    }

    private fun csi(params: String, final: Char) {
        if (params.startsWith("?") || params.startsWith(">")) return
        val ps = params.split(';').map { it.toIntOrNull() ?: 0 }.let { if (params.isEmpty()) emptyList() else it }
        val n = maxOf(1, ps.firstOrNull() ?: 1)
        when (final) {
            'm' -> sgr(ps)
            'K' -> when (ps.firstOrNull() ?: 0) { 0 -> eraseLine(col, Int.MAX_VALUE); 1 -> eraseLine(0, col + 1); else -> eraseLine(0, Int.MAX_VALUE) }
            'J' -> when (ps.firstOrNull() ?: 0) {
                0 -> { eraseLine(col, Int.MAX_VALUE); while (text.size > row + 1) { text.removeAt(text.size - 1); colors.removeAt(colors.size - 1) } }
                else -> { top = text.size; row = top; col = 0; line(row) }
            }
            'A' -> row = maxOf(top, row - n)
            'B' -> { row += n; line(row) }
            'C' -> col += n
            'D' -> col = maxOf(0, col - n)
            'G' -> col = n - 1
            'H', 'f' -> { row = top + maxOf(1, ps.getOrNull(0) ?: 1) - 1; col = maxOf(1, ps.getOrNull(1) ?: 1) - 1; line(row) }
            'P' -> { val l = line(row); val cs = colors[row]; repeat(minOf(n, maxOf(0, l.length - col))) { l.deleteCharAt(col); cs.removeAt(col) } }
            'X' -> eraseLine(col, col + n)
            '@' -> { val l = line(row); val cs = colors[row]; if (col <= l.length) repeat(n) { l.insert(col, ' '); cs.add(col, -1) } }
        }
    }

    fun write(data: String) {
        val s = pending + data
        pending = ""
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '\u001b' -> {
                    if (i + 1 >= s.length) { pending = s.substring(i); return }
                    when (s[i + 1]) {
                        '[' -> {
                            var j = i + 2
                            while (j < s.length && s[j].code in 0x20..0x3f) j++
                            if (j >= s.length) { pending = s.substring(i); return }
                            csi(s.substring(i + 2, j), s[j])
                            i = j
                        }
                        ']', 'P', '_', '^' -> {
                            var j = i + 2
                            while (j < s.length && s[j] != '\u0007' && !(s[j] == '\u001b' && s.getOrNull(j + 1) == '\\')) j++
                            if (j >= s.length) { pending = s.substring(i); return }
                            i = if (s[j] == '\u0007') j else j + 1
                        }
                        '(', ')', '#' -> i += 2
                        else -> i += 1
                    }
                }
                c == '\n' -> { row++; col = 0; line(row); trim() }
                c == '\r' -> col = 0
                c == '\b' -> col = maxOf(0, col - 1)
                c == '\t' -> repeat(8 - col % 8) { put(' ') }
                c.code < 0x20 || c.code == 0x7f -> Unit
                else -> put(c)
            }
            i++
        }
    }

    fun lines(): List<TermLine> = text.indices.map { r ->
        val cs = colors[r]
        val runs = mutableListOf<TermRun>()
        var start = 0
        for (k in 1..cs.size) if (k == cs.size || cs[k] != cs[start]) { if (cs[start] >= 0) runs += TermRun(start, k, cs[start]); start = k }
        TermLine(text[r].toString(), runs)
    }.dropLastWhile { it.text.isEmpty() }
}

// The keys web/src/workspace/Terminal.tsx puts above the phone keyboard.
val TERM_KEYS = listOf("Esc" to "\u001b", "Tab" to "\t", "^C" to "\u0003", "^D" to "\u0004", "Up" to "\u001b[A", "Down" to "\u001b[B", "Left" to "\u001b[D", "Right" to "\u001b[C")

fun termInput(data: String) = buildJsonObject { put("t", "i"); put("d", data) }.toString()

@kotlinx.serialization.Serializable
data class TermTab(val id: String, val name: String = "")

fun parseTerms(body: String): List<TermTab> = protocolJson.decodeFromString(kotlinx.serialization.builtins.ListSerializer(TermTab.serializer()), body)

fun wsOrigin(origin: String) = origin.replaceFirst(Regex("^http"), "ws")

// web/src/workspace/termReconnect.ts: 4404 means the terminal is gone, anything else retries with a growing delay.
fun termGone(code: Int) = code == 4404
private val DELAYS = listOf(1000L, 2000L, 4000L, 8000L, 10000L)
fun termDelay(attempt: Int) = DELAYS[minOf(attempt, DELAYS.size - 1)]

// The streamed Chrome tab of web/src/workspace/BrowserPane.tsx, read only.
data class ChromeTab(val id: String, val title: String, val url: String)

sealed interface ChromeMsg {
    data class State(val state: String, val reason: String, val own: Boolean) : ChromeMsg
    data class Tabs(val tabs: List<ChromeTab>, val current: String?) : ChromeMsg
    data class Frame(val data: String) : ChromeMsg
}

fun parseChrome(text: String): ChromeMsg? = runCatching {
    val o = protocolJson.parseToJsonElement(text) as kotlinx.serialization.json.JsonObject
    fun str(k: String, from: kotlinx.serialization.json.JsonObject = o) = (from[k] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
    when (str("t")) {
        "state" -> ChromeMsg.State(str("state") ?: "off", str("reason") ?: "", (o["own"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true")
        "tabs" -> ChromeMsg.Tabs(
            (o["tabs"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { e -> (e as? kotlinx.serialization.json.JsonObject)?.let { ChromeTab(str("id", it) ?: "", str("title", it) ?: "", str("url", it) ?: "") } } ?: emptyList(),
            str("current"),
        )
        "frame" -> str("data")?.let { ChromeMsg.Frame(it) }
        else -> null
    }
}.getOrNull()

val CHROME_REASONS = mapOf(
    "nofda" to "Needs Full Disk Access",
    "nochrome" to "Chrome is not running",
    "disabled" to "Remote debugging is off",
    "denied" to "Chrome refused the connection",
    "timeout" to "Chrome did not answer",
    "closed" to "Connection to Chrome closed",
    "server" to "Server not reachable",
)

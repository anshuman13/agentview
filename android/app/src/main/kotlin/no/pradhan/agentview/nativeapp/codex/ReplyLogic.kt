package no.pradhan.agentview.nativeapp.codex

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import no.pradhan.agentview.nativeapp.net.Writes
import no.pradhan.agentview.nativeapp.net.protocolJson

// web/src/codex/overview/ReplyQueue.tsx: Slack and Gmail asks, and what sending, skipping and snoozing them does.
const val STALE_DAYS = 3

fun isSaid(r: Row) = r.id.startsWith("said:")
fun needsMine(r: Row) = "needs-you" in tagList(r.tags)
fun isFaq(r: Row) = "faq" in tagList(r.tags)
fun drafted(r: Row) = !r.draft.isNullOrBlank()
// An ask is a Slack or Gmail row waiting for review; it lives in the reply queue only, so Up next, Today, Tasks and Needs you leave it out.
fun queued(r: Row) = (r.source == "slack" || r.source == "gmail") && r.status == "suggested" && !r.deleted && !isSaid(r)

data class Check(val done: Boolean, val label: String)
data class AskParts(val quote: String, val steps: List<Check>)

private val CHECK_RE = Regex("^\\s*[-*] \\[([ xX])\\](.*)$", RegexOption.MULTILINE)
// web/src/codex/tasks/editor/taskChecklist.ts: the checklist lines of a text.
fun checkItems(text: String?): List<Check> = CHECK_RE.findAll(text ?: "").map { Check(it.groupValues[1].lowercase() == "x", it.groupValues[2].trim()) }.toList()

// An ask's text split into its quote (the lines before the first checklist line) and its steps.
fun askParts(text: String?): AskParts {
    val t = (text ?: "").trim()
    val lines = t.lines()
    val first = lines.indexOfFirst { CHECK_RE.containsMatchIn(it) }
    return AskParts(if (first < 0) t else lines.take(first).joinToString("\n").trim(), checkItems(t))
}

// What an ask row shows: the status line, the primary button and the More menu entries ("Snooze" stands for the snooze options).
fun askStatus(r: Row) = if (needsMine(r)) "Needs you" else if (drafted(r)) "Reply ready" else "No draft"
private fun sendable(r: Row) = r.source == "slack" && drafted(r)
fun askPrimary(r: Row) = if (sendable(r)) (if (needsMine(r)) "Approve" else "Send") else "Open"
fun askMenu(r: Row) = listOfNotNull(
    "Edit draft".takeIf { sendable(r) },
    "History".takeIf { sendable(r) && r.people != null },
    "Open thread".takeIf { !r.sourceUrl.isNullOrEmpty() && askPrimary(r) != "Open" },
) + listOf("Done", "Make task", "Snooze", "Ask Claude", "Skip")
private fun isAdmin(r: Row) = tagList(r.tags).any { it == "access" || it == "limit" }

fun adminList(rows: List<Row>) = rows.filter(::isAdmin).joinToString("\n") { "- ${it.people?.ifEmpty { null } ?: "Slack"}: ${it.title}${it.sourceUrl?.takeIf { u -> u.isNotEmpty() }?.let { u -> " $u" } ?: ""}" }
fun adminCount(rows: List<Row>) = rows.count(::isAdmin)

// Asks with a draft first, the ones that need me first, then FAQ answers, then oldest first.
fun replyQueue(items: List<Row>, profile: String?, now: Long): List<Row> = items
    .filter { r ->
        queued(r) && matchesProfile(profile, r) && !((r.snoozedUntil ?: 0L) > now)
    }
    .sortedWith(compareByDescending<Row> { drafted(it) }.thenByDescending { needsMine(it) }.thenByDescending { isFaq(it) }.thenBy { it.statusTime })

fun staleAsks(rows: List<Row>, now: Long) = rows.filter { now - it.statusTime > STALE_DAYS * DAY_MS }

class SnoozeOption(val label: String, val at: Long)

fun snoozeOptions(now: Long, profile: String): List<SnoozeOption> {
    val next = nextNine(now, profile)
    val day = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH).format(Instant.ofEpochMilli(next).atZone(codexZone))
    return listOfNotNull(
        SnoozeOption(SNOOZES[0].label, SNOOZES[0].at(now, profile)),
        if (hourOf(now) < 15) SnoozeOption("Later today, 16:00", atHour(Instant.ofEpochMilli(now).atZone(codexZone).toLocalDate(), 16)) else null,
        SnoozeOption("Next workday, $day 09:00", next),
    )
}

@Serializable class HistoryLine(val at: Long = 0, val line: String = "")
@Serializable class ReplyHistory(val replies: List<HistoryLine> = emptyList())
@Serializable class SentReply(val status: String = "", val url: String? = null)

fun sentMessage(status: String) = when (status) {
    "answered" -> "Not sent: someone already answered in the thread"
    "changed" -> "Not sent: the thread changed since the draft"
    else -> "Reply sent"
}

// The hub calls the reply queue needs; Api implements them and tests fake them.
interface AssistantRemote {
    suspend fun autopilot(patch: String?): String
    suspend fun replyHistory(who: String): String
    suspend fun sendReply(id: String, edited: Boolean, text: String?): String
    suspend fun skipAsk(id: String)
}

// Sending and skipping go through Writes, so a read-only run refuses them with a notice; history is a read.
class ReplyOps(
    private val remote: AssistantRemote,
    private val writes: Writes,
    private val store: CodexStore,
    private val snack: (String, (() -> Unit)?) -> Unit,
) {
    private val cache = HashMap<String, ReplyHistory>()
    private fun keyOf(who: String) = who.trim().lowercase()

    suspend fun history(who: String): ReplyHistory {
        cache[keyOf(who)]?.let { return it }
        val h = protocolJson.decodeFromString(ReplyHistory.serializer(), remote.replyHistory(who))
        cache[keyOf(who)] = h
        return h
    }

    private suspend fun post(row: Row, text: String, edited: Boolean): SentReply {
        val r = protocolJson.decodeFromString(SentReply.serializer(), remote.sendReply(row.id, edited, text))
        if (r.status == "sent" || r.status == "dry") row.people?.let { cache.remove(keyOf(it)) }
        store.sync()
        return r
    }

    // The text goes with the request, so an edit made a moment ago is what gets posted before it has synced.
    fun send(row: Row, text: String, edited: Boolean, done: (Boolean, String?) -> Unit = { _, _ -> }) {
        var failure: String? = null
        writes.run("Reply not sent", {
            try { snack(sentMessage(post(row, text.trim(), edited).status), null) } catch (e: Exception) { failure = e.message ?: "Reply not sent"; throw e }
        }) { ok -> done(ok, failure) }
    }

    fun skip(row: Row, done: (Boolean) -> Unit = {}) {
        writes.run("Skip failed", { remote.skipAsk(row.id); store.sync(); snack("Skipped, no reply sent", null) }, done)
    }

    // Posts every FAQ answer as it reads, one after the other, and reports how many went out.
    fun sendAllFaq(rows: List<Row>, done: () -> Unit = {}) {
        var sent = 0
        writes.run("FAQ answers not sent", {
            for (r in rows) {
                val res = try { post(r, (r.draft ?: "").trim(), false) } catch (e: Exception) { break }
                if (res.status == "sent" || res.status == "dry") sent++
            }
            snack(if (sent == rows.size) "Sent $sent FAQ answers" else "Sent $sent of ${rows.size} FAQ answers", null)
        }) { done() }
    }
}

fun ymd(t: Long): String = DateTimeFormatter.ISO_LOCAL_DATE.format(Instant.ofEpochMilli(t).atZone(codexZone))

// web/src/codex/data/tasks/review.ts: what the Slack scan read today and did not take as asks, newest first.
@Serializable class Ignored(val url: String = "", val from: String = "", val gist: String = "", val at: Long = 0)

fun ignoredToday(briefs: List<Row>, profile: String?, now: Long): List<Ignored> {
    val day = ymd(now)
    return briefs.filter { !it.deleted && it.str("kind") == "slack-ignored" && matchesProfile(profile, it) }.flatMap { b ->
        try { protocolJson.decodeFromString(ListSerializer(Ignored.serializer()), b.str("rows") ?: "[]") } catch (e: Exception) { emptyList() }
    }.filter { it.url.isNotEmpty() && it.from.isNotEmpty() && it.gist.isNotEmpty() && ymd(it.at) == day }.sortedByDescending { it.at }
}

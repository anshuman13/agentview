package no.pradhan.agentview.nativeapp.codex

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.net.Writes
import no.pradhan.agentview.nativeapp.net.protocolJson

// web/src/codex/overview/ReplyQueue.tsx: Slack asks with a reply draft, and what sending, skipping and snoozing them does.
const val STALE_DAYS = 3

fun isSaid(r: Row) = r.id.startsWith("said:")
fun needsMine(r: Row) = "needs-you" in tagList(r.tags)
fun isFaq(r: Row) = "faq" in tagList(r.tags)
fun drafted(r: Row) = !r.draft.isNullOrBlank()
private fun isAdmin(r: Row) = tagList(r.tags).any { it == "access" || it == "limit" }

fun adminList(rows: List<Row>) = rows.filter(::isAdmin).joinToString("\n") { "- ${it.people?.ifEmpty { null } ?: "Slack"}: ${it.title}${it.sourceUrl?.takeIf { u -> u.isNotEmpty() }?.let { u -> " $u" } ?: ""}" }
fun adminCount(rows: List<Row>) = rows.count(::isAdmin)

// The ones that need me first, then FAQ answers, then oldest first; an ask without a draft that needs me comes last.
fun replyQueue(items: List<Row>, profile: String?, now: Long): List<Row> = items
    .filter { r ->
        r.source == "slack" && (r.status == "suggested" || r.status == "open") && !r.deleted && matchesProfile(profile, r) &&
            (drafted(r) || needsMine(r)) && !isSaid(r) && !((r.snoozedUntil ?: 0L) > now)
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

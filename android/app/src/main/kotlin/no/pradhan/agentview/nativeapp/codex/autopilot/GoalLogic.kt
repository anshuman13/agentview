package no.pradhan.agentview.nativeapp.codex.autopilot

import java.time.Instant
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.codexZone
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.ui.BadgeTone

// The goal sheet and detail (web/src/sessions/GoalSheet.tsx, GoalDetail.tsx, goalLogic.ts and shared/goalForm.ts).

sealed interface GoalSheet {
    data class Start(val plan: String? = null, val here: Boolean = false) : GoalSheet
    data class Detail(val run: String) : GoalSheet
}

// What the start sheet collects: every in ms (0 for until done), the stop as ms from now or as HH:MM, the weekly cap in percent.
class GoalForm(val what: String, val every: Long, val stopIn: Long?, val stopAt: String?, val capPct: Int?)

fun goalCommand(form: GoalForm, now: Long): String {
    val stop = form.stopAt ?: form.stopIn?.takeIf { it > 0 }?.let { clock(now + it) }
    val what = form.what.trim().replace(Regex("^/goal\\s+"), "")
    return listOfNotNull("/goal", form.every.takeIf { it > 0 }?.let { "every ${everyText(it)}" }, stop?.let { "until $it" }, form.capPct?.takeIf { it > 0 }?.let { "cap $it%" }, what.ifEmpty { null }).joinToString(" ")
}

// shared/goalForm.ts parseEvery: a custom How often such as "45m", "45 min" or "3h", 10 minutes to 7 days, in ms.
fun parseEvery(text: String): Long? {
    val m = Regex("^(\\d+)\\s*(m|min|h)$", RegexOption.IGNORE_CASE).find(text.trim()) ?: return null
    val ms = (m.groupValues[1].toLongOrNull() ?: return null) * (if (m.groupValues[2].equals("h", true)) HOUR else 60_000L)
    return ms.takeIf { it in 10 * 60_000L..7 * 24 * HOUR }
}

// The plan path of a goal that runs every task of a plan file, else null.
fun planOf(what: String): String? = Regex("^(?:/goal\\s+)?(?:every task in (\\S+) is ticked|every step of the plan in (\\S+) is done)").find(what.trim())?.groupValues?.drop(1)?.firstOrNull { it.isNotEmpty() }

private const val HOUR = 3_600_000L

class EveryChoice(val label: String, val ms: Long)

val EVERY = listOf(EveryChoice("Until done", 0), EveryChoice("Every 30m", 30 * 60_000L), EveryChoice("Every 1h", HOUR), EveryChoice("Every 2h", 2 * HOUR))

class StopChoice(val label: String, val stopIn: Long? = null, val stopAt: String? = null)

val STOPS = listOf(StopChoice("None"), StopChoice("In 1 hour", stopIn = HOUR), StopChoice("In 4 hours", stopIn = 4 * HOUR), StopChoice("07:00", stopAt = "07:00"))

class CapChoice(val label: String, val pct: Int?)

val CAPS = listOf(CapChoice("50", 50), CapChoice("70", 70), CapChoice("90", 90), CapChoice("Off", null))

fun stopAtMs(stop: StopChoice, now: Long): Long? {
    if (stop.stopIn != null) return now + stop.stopIn
    val (h, m) = (stop.stopAt ?: return null).split(':').map { it.toInt() }
    val t = Instant.ofEpochMilli(now).atZone(codexZone).withHour(h).withMinute(m).withSecond(0).withNano(0)
    return (if (t.toInstant().toEpochMilli() <= now) t.plusDays(1) else t).toInstant().toEpochMilli()
}

private val PLANNED_ENDS = listOf("Goal met", "Stopped at", "Usage cap", "Ran for 28 days", "goal met", "end time", "weekly usage cap", "ran for 28 days")

fun goalBadge(run: ChatRun): Pair<String, BadgeTone> = when {
    run.state == "done" -> when {
        PLANNED_ENDS.any { run.why.startsWith(it) } -> "Done" to BadgeTone.Done
        run.why == "you stopped it" -> "Skipped" to BadgeTone.Quiet
        else -> "Failed" to BadgeTone.Failed
    }
    run.needsYou -> "Needs you" to BadgeTone.Waiting
    run.state == "paused" -> "Waiting" to BadgeTone.Waiting
    else -> "Running" to BadgeTone.Running
}

fun usageLine(run: ChatRun): String {
    val week = run.usage?.week?.let { "Week ${Math.round(it.pct)}%${run.capPct?.let { c -> " of $c% cap" } ?: ""}" }
    val five = run.usage?.fiveHour?.let { "5-hour ${Math.round(it.pct)}%" }
    return listOfNotNull(week, five).joinToString(" · ").ifEmpty { run.capPct?.let { "$it% cap" } ?: "No cap" }
}

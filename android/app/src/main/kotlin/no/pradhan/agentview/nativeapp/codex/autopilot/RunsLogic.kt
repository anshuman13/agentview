package no.pradhan.agentview.nativeapp.codex.autopilot

import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Edits
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.LiveNow
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.net.Round
import no.pradhan.agentview.nativeapp.net.RunTry
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.plural
import no.pradhan.agentview.nativeapp.sessions.state
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.workspace.PrFile
import no.pradhan.agentview.nativeapp.ui.agoShort

// Loops, goals, tries and jobs (web/src/chat/composerLogic.ts runLine).

private val KIND = mapOf("loop" to "Loop", "goal" to "Goal", "tries" to "Tries", "job" to "Job")

// A prompt queued with Send at: a one-shot loop that has not fired yet (web sessions/runLogic.ts sendsAt).
fun sendsAt(run: ChatRun): Long? = run.nextAt.takeIf { run.kind == "loop" && run.once && run.state == "running" && run.round == 0 }

// What a waiting loop or goal asked in its last round: the row's meta line carries it after the age (web sessions/runLogic.ts askLine).
fun askLine(run: LiveRun?): String? = run?.line?.takeIf { run.needsYou && (run.outcome == "question" || run.outcome == "blocked") }

fun runLine(run: ChatRun): String = sendsAt(run)?.let { "Sends at ${clock(it)}" } ?: when {
    run.state == "paused" -> if (run.why.isNotEmpty()) "Paused · ${run.why}" else "Paused"
    run.kind == "goal" -> roundLine("Goal", run)
    run.kind == "tries" -> "Tries · ${run.tries.count { !it.dropped }} chats"
    run.kind == "job" -> "Job · ${run.branch}"
    else -> roundLine("Loop", run)
}

private fun roundLine(word: String, run: ChatRun) = "$word · round ${run.round}" + (if (run.max > 0) " of ${run.max}" else "") + (run.nextAt?.let { " · next ${clock(it)}" } ?: "")

fun finishedLine(why: String, endedAt: Long?, ago: (Long) -> String): String? =
    if (why.isEmpty()) null else why.replaceFirstChar(Char::uppercase) + (endedAt?.let { " · ${ago(it)}" } ?: "")

fun firstRoundText(at: Long?) = "First round" + (at?.let { " ${clock(it)}" } ?: "")

fun nextRoundText(at: Long?) = "Next round" + (at?.let { " ${clock(it)}" } ?: "")

// Web span in shared/util.ts.
fun everyText(ms: Long) = if (ms % 3_600_000L == 0L) "${ms / 3_600_000L}h" else "${Math.round(ms / 60_000.0)}m"

// One column of the tries board (web/src/sessions/TriesBoard.tsx tryColumn): the try's state, last report, diff size and cost.
data class TryColumn(val n: Int, val branch: String, val state: String, val line: String, val edits: Edits?, val cost: Double, val archived: Boolean)

fun tryColumn(run: ChatRun, t: RunTry, live: List<LiveChat>): TryColumn {
    val chat = live.firstOrNull { it.sessionId == t.sessionId }
    val rounds = run.rounds.filter { it.n == t.n }
    val last = rounds.lastOrNull()
    val state = when {
        t.dropped -> "Archived"
        chat?.pending?.let { it > 0 } == true || last?.outcome == "blocked" || last?.outcome == "question" -> "Needs you"
        chat?.running == true || last == null -> "Running"
        last.outcome == "failed" -> "Failed"
        else -> "Done"
    }
    return TryColumn(t.n, t.branch, state, last?.line?.replace(Regex("^Try \\d+: "), "") ?: chat?.last ?: "", chat?.edits, chat?.cost ?: rounds.sumOf { it.costUsd }, t.dropped)
}

private fun roundOutcome(r: Round) = when {
    r.outcome == "quiet" -> "nothing to do"
    r.line.isEmpty() -> r.outcome
    else -> "${r.outcome}: ${r.line}"
}

private fun roundSummary(r: Round) = "Round ${r.n} · ${clock(r.at)} · " + roundOutcome(r)

// A round as every list shows it (web shared/goalText.ts roundText).
fun roundText(r: Round) = if (r.report != null) "Weekly report" else roundSummary(r)

// Rounds in time order, each run of consecutive quiet rounds (not a weekly report) merged (web shared/goalText.ts mergeQuiet).
data class RoundGroup(val first: Round, val last: Round, val count: Int, val costUsd: Double)

fun mergeQuiet(rounds: List<Round>): List<RoundGroup> {
    val groups = mutableListOf<RoundGroup>()
    for (r in rounds) {
        val g = groups.lastOrNull()
        val quiet = r.outcome == "quiet" && r.report == null
        if (g != null && quiet && g.last.outcome == "quiet" && g.last.report == null) groups[groups.lastIndex] = g.copy(last = r, count = g.count + 1, costUsd = g.costUsd + r.costUsd)
        else groups.add(RoundGroup(r, r, 1, r.costUsd))
    }
    return groups
}

// How the kept rounds went, by outcome: "2 done · 1 blocked · 8 nothing to do" (web shared/goalText.ts roundsSummary, fixture rounds-summary.json).
fun roundsSummary(rounds: List<Round>) = listOf("done", "progress", "blocked", "question", "failed", "quiet")
    .map { o -> o to rounds.count { it.outcome == o } }
    .filter { it.second > 0 }
    .joinToString(" · ") { (o, n) -> "$n ${if (o == "quiet") "nothing to do" else o}" }

fun roundGroupText(g: RoundGroup) = if (g.count > 1) "Rounds ${g.first.n}-${g.last.n} · ${clock(g.last.at)} · nothing to do" else roundText(g.last)

// The loop card's first row (web composerLogic loopNow): the agent's status or the last round, whichever is newer.
data class LoopNow(val title: String, val at: Long?, val source: String, val next: String? = null, val stepsLeft: Int = 0)

fun loopNow(run: ChatRun, now: LiveNow?): LoopNow {
    val last = run.rounds.lastOrNull()
    if (now != null && now.at >= run.startedAt && (last == null || now.at >= last.at)) {
        return LoopNow(now.text, now.at, "status", next = now.next?.firstOrNull(), stepsLeft = now.next?.size ?: 0)
    }
    if (last != null) return LoopNow(roundSummary(last), null, "round")
    return LoopNow(firstRoundText(run.nextAt), null, "none")
}

// The meta line of the loop card's first row (web runLogic nowMeta): the status time, the next step, the steps left and the build limit.
fun nowMeta(now: LoopNow, builds: String): String = listOfNotNull(
    now.at?.let { clock(it) },
    now.next?.let { "Next: $it" },
    now.stepsLeft.takeIf { it > 0 }?.let { "${plural(it, "step")} left" },
    builds.ifEmpty { null },
).joinToString(" · ")

fun agentAge(startedAt: Long, now: Long): String {
    val min = maxOf(1L, (now - startedAt) / 60_000)
    return if (min < 60) "$min min" else "${min / 60} h ${min % 60} min"
}

fun stoppedText(run: ChatRun, running: Boolean) = "${KIND[run.kind] ?: "Loop"} stopped" + if (running && run.round > 0 && (run.kind == "goal" || run.kind == "loop")) " · round ${run.round} was running" else ""

fun outcomeDot(outcome: String) = when (outcome) {
    "blocked", "question" -> DotState.Warn
    "failed" -> DotState.Bad
    "done" -> DotState.Ok
    else -> DotState.Faint
}

enum class RunBadge { Next, Paused, Needs }

// What a Sessions row shows for the run its chat is on: the next time, "Paused" or "Needs you".
fun runBadge(run: LiveRun): RunBadge? = when {
    run.state == "done" -> null
    run.needsYou -> RunBadge.Needs
    run.state == "paused" -> RunBadge.Paused
    else -> RunBadge.Next
}

// The diff of a job run for review (web sessionApi RunDiff), from /api/runs/diff.
@Serializable
data class RunDiff(val branch: String = "", val files: List<PrFile> = emptyList(), val diff: String = "")

fun parseRunDiff(body: String): RunDiff = protocolJson.decodeFromString(RunDiff.serializer(), body)

// A commit of a run's folder (web GitCommit), from /api/git/log.
@Serializable
data class GitCommit(val hash: String, val subject: String, val at: Long)

@Serializable
private data class GitLog(val commits: List<GitCommit> = emptyList())

fun parseGitLog(body: String): List<GitCommit> = protocolJson.decodeFromString(GitLog.serializer(), body).commits

// The review summary row's meta (web ReviewCard): "<branch> · +A -D · N files · <ago>".
fun reviewMeta(run: ChatRun, diff: RunDiff?, now: Long): String {
    val size = diff?.let { d -> listOf("+${d.files.sumOf { it.additions }} -${d.files.sumOf { it.deletions }}", plural(d.files.size, "file")) } ?: emptyList()
    return (listOf(run.branch) + size + agoShort(run.rounds.lastOrNull()?.at ?: run.startedAt, now, " ago")).joinToString(" · ")
}

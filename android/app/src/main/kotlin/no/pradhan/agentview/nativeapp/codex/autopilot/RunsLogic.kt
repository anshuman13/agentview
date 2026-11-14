package no.pradhan.agentview.nativeapp.codex.autopilot

import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.jobs.JobState
import no.pradhan.agentview.nativeapp.codex.jobs.jobState
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Edits
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.LiveNow
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.net.Round
import no.pradhan.agentview.nativeapp.net.RunTry
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ops.plural
import no.pradhan.agentview.nativeapp.sessions.state
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.workspace.PrFile
import no.pradhan.agentview.nativeapp.workspace.agoShort

// Loops, goals and build cycles (web/src/chat/composerLogic.ts runLine and the Runs page bands).

const val RUNS_FINISHED = 30
private val KIND = mapOf("loop" to "Loop", "goal" to "Goal", "cycle" to "Build cycle", "tries" to "Tries", "job" to "Job")

fun runLine(run: ChatRun, phase: String? = null): String = when {
    run.state == "paused" -> if (run.why.isNotEmpty()) "Paused · ${run.why}" else "Paused"
    run.kind == "goal" -> roundLine("Goal", run)
    run.kind == "tries" -> "Tries · ${run.tries.count { !it.dropped }} chats"
    run.kind == "job" -> "Job · ${run.branch}"
    run.kind == "cycle" -> "Build cycle · round ${run.round}/${run.max}" + (phase?.takeIf { it != "passed" && it != "failed" }?.let { " · ${it.replaceFirstChar(Char::uppercase)}" } ?: "")
    else -> roundLine("Loop", run)
}

private fun roundLine(word: String, run: ChatRun) = "$word · round ${run.round}" + (if (run.max > 0) " of ${run.max}" else "") + (run.nextAt?.let { " · next ${clock(it)}" } ?: "")

fun finishedLine(why: String, endedAt: Long?, ago: (Long) -> String): String? =
    if (why.isEmpty()) null else why.replaceFirstChar(Char::uppercase) + (endedAt?.let { " · ${ago(it)}" } ?: "")

fun firstRoundText(at: Long?) = "First round" + (at?.let { " ${clock(it)}" } ?: "")

fun nextRoundText(at: Long?) = "Next round" + (at?.let { " ${clock(it)}" } ?: "")

fun everyText(ms: Long) = if (ms % 3_600_000L == 0L) "${ms / 3_600_000L}h" else "${ms / 60_000L}m"

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

fun roundGroupText(g: RoundGroup) = if (g.count > 1) "Rounds ${g.first.n}-${g.last.n} · ${clock(g.last.at)} · nothing to do" else roundText(g.last)

// The run row's last round (web shared/goalText.ts lastRoundText): the outcome alone when the run line already says this round.
fun lastRoundText(run: ChatRun, r: Round) = when {
    r.report != null -> "Weekly report"
    (run.kind == "goal" || run.kind == "loop") && run.state != "paused" && r.n == run.round -> roundOutcome(r)
    else -> roundSummary(r)
}

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

fun agentAge(startedAt: Long, now: Long): String {
    val min = maxOf(1L, (now - startedAt) / 60_000)
    return if (min < 60) "$min min" else "${min / 60} h ${min % 60} min"
}

fun stoppedText(run: ChatRun, running: Boolean) = "${KIND[run.kind] ?: "Loop"} stopped" + if (running && run.round > 0 && (run.kind == "goal" || run.kind == "loop")) " · round ${run.round} was running" else ""

// Web runNeedsYou in shared/advisors.ts: the run asks, or its last round is blocked, a question or failed.
private val NEEDS_YOU = setOf("blocked", "question", "failed")

fun runNeedsYou(run: ChatRun) = run.needsYou || run.rounds.lastOrNull()?.outcome in NEEDS_YOU

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

// The Sessions tab count: waiting requests, and a chat whose run needs you.
fun sessionsBadge(live: List<LiveChat>, shownId: String) =
    live.filter { it.id != shownId }.sumOf { if (it.pending > 0) it.pending else if (it.run?.needsYou == true) 1 else 0 }

sealed interface RunEntry {
    data class Chat(val run: ChatRun) : RunEntry
    data class Job(val row: Row, val state: JobState) : RunEntry
}

data class RunBands(val review: List<ChatRun>, val needs: List<RunEntry>, val running: List<RunEntry>, val finished: List<ChatRun>)

fun runBands(runs: List<ChatRun>, jobs: List<Row>, jobRuns: List<Row>, now: Long): RunBands {
    val open = runs.filter { it.state != "done" }.sortedByDescending { it.startedAt }
    val review = open.filter { it.kind == "job" && it.review == "pending" }
    val active = open - review.toSet()
    val states = jobs.filter { !it.deleted }.mapNotNull { j -> jobState(j, jobRuns, now)?.let { RunEntry.Job(j, it) } }
    return RunBands(
        review = review,
        needs = active.filter { it.needsYou }.map { RunEntry.Chat(it) } + states.filter { it.state == JobState.Failed },
        running = active.filterNot { it.needsYou }.map { RunEntry.Chat(it) } + states.filter { it.state == JobState.Running || it.state == JobState.Queued },
        finished = runs.filter { it.state == "done" }.sortedByDescending { it.endedAt ?: it.startedAt }.take(RUNS_FINISHED),
    )
}

// The diff of a job run for review (web sessionApi RunDiff), from /api/runs/diff.
@Serializable
data class RunDiff(val branch: String = "", val files: List<PrFile> = emptyList(), val diff: String = "")

fun parseRunDiff(body: String): RunDiff = protocolJson.decodeFromString(RunDiff.serializer(), body)

// The review summary row's meta (web ReviewCard): "<branch> · +A -D · N files · <ago>".
fun reviewMeta(run: ChatRun, diff: RunDiff?, now: Long): String {
    val size = diff?.let { d -> listOf("+${d.files.sumOf { it.additions }} -${d.files.sumOf { it.deletions }}", plural(d.files.size, "file")) } ?: emptyList()
    return (listOf(run.branch) + size + agoShort(run.rounds.lastOrNull()?.at ?: run.startedAt, now, " ago")).joinToString(" · ")
}

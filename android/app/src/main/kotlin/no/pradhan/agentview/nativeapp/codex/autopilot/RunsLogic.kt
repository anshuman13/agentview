package no.pradhan.agentview.nativeapp.codex.autopilot

import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.codex.jobs.JobState
import no.pradhan.agentview.nativeapp.codex.jobs.jobState
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Edits
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.net.Queued
import no.pradhan.agentview.nativeapp.net.Round
import no.pradhan.agentview.nativeapp.net.RunTry
import no.pradhan.agentview.nativeapp.sessions.state
import no.pradhan.agentview.nativeapp.ui.DotState

// Loops, goals and build cycles (web/src/chat/composerLogic.ts runLine and the Runs page bands).

const val RUNS_FINISHED = 30
private val KIND = mapOf("loop" to "Loop", "goal" to "Goal", "cycle" to "Build cycle", "tries" to "Tries")

fun runLine(run: ChatRun, phase: String? = null): String = when {
    run.state == "paused" -> if (run.why.isNotEmpty()) "Paused · ${run.why}" else "Paused"
    run.kind == "goal" && run.every != null -> "Standing goal · every ${everyText(run.every)} · at most ${86_400_000L / run.every} rounds a day"
    run.kind == "goal" -> "Goal · check ${run.round} of ${run.max}"
    run.kind == "tries" -> "Tries · ${run.tries.count { !it.dropped }} chats"
    run.kind == "cycle" -> "Build cycle · round ${run.round}/${run.max}" + (phase?.takeIf { it != "passed" && it != "failed" }?.let { " · ${it.replaceFirstChar(Char::uppercase)}" } ?: "")
    else -> "Loop · round ${run.round}" + (run.nextAt?.let { " · next ${clock(it)}" } ?: "")
}

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

fun roundText(r: Round) = if (r.report != null) "Weekly report" else r.line.ifEmpty { r.outcome }

fun stoppedText(run: ChatRun) = "${KIND[run.kind] ?: "Loop"} stopped"

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

data class RunBands(val needs: List<RunEntry>, val running: List<RunEntry>, val finished: List<ChatRun>)

fun runBands(runs: List<ChatRun>, jobs: List<Row>, jobRuns: List<Row>, now: Long): RunBands {
    val active = runs.filter { it.state != "done" }.sortedByDescending { it.startedAt }
    val states = jobs.filter { !it.deleted }.mapNotNull { j -> jobState(j, jobRuns, now)?.let { RunEntry.Job(j, it) } }
    return RunBands(
        needs = active.filter { it.needsYou }.map { RunEntry.Chat(it) } + states.filter { it.state == JobState.Failed },
        running = active.filterNot { it.needsYou }.map { RunEntry.Chat(it) } + states.filter { it.state == JobState.Running || it.state == JobState.Queued },
        finished = runs.filter { it.state == "done" }.sortedByDescending { it.endedAt ?: it.startedAt }.take(RUNS_FINISHED),
    )
}

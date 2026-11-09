package no.pradhan.agentview.nativeapp

// Loops, goals and build cycles (web/src/chat/composerLogic.ts runLine and the Runs page bands).

const val RUNS_FINISHED = 30
private val KIND = mapOf("loop" to "Loop", "goal" to "Goal", "cycle" to "Build cycle")

fun runLine(run: ChatRun, phase: String? = null): String = when {
    run.state == "paused" -> if (run.why.isNotEmpty()) "Paused · ${run.why}" else "Paused"
    run.kind == "goal" && run.every != null -> "Standing goal · every ${everyText(run.every)} · at most ${86_400_000L / run.every} rounds a day"
    run.kind == "goal" -> "Goal · check ${run.round} of ${run.max}"
    run.kind == "cycle" -> "Build cycle · round ${run.round}/${run.max}" + (phase?.takeIf { it != "passed" && it != "failed" }?.let { " · ${it.replaceFirstChar(Char::uppercase)}" } ?: "")
    else -> "Loop · round ${run.round}" + (run.nextAt?.let { " · next ${clock(it)}" } ?: "")
}

private fun everyText(ms: Long) = if (ms % 3_600_000L == 0L) "${ms / 3_600_000L}h" else "${ms / 60_000L}m"

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

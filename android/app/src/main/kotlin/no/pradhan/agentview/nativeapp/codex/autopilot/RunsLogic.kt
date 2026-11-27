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

// Tries and jobs (web/src/chat/composerLogic.ts runLine).

private val KIND = mapOf("tries" to "Tries", "job" to "Job", "build" to "Build")

// The run a chat is on, while it is not done.
fun activeRun(runs: List<ChatRun>, chatId: String?) = runs.lastOrNull { it.chatId == chatId && it.state != "done" }

// What a waiting run asked in its last round: the row's meta line carries it after the age (web sessions/runLogic.ts askLine).
fun askLine(run: LiveRun?): String? = run?.line?.takeIf { run.needsYou && (run.outcome == "question" || run.outcome == "blocked") }

fun runLine(run: ChatRun): String = when {
    run.state == "paused" -> if (run.why.isNotEmpty()) "Paused · ${run.why}" else "Paused"
    run.kind == "tries" -> "Tries · ${run.tries.count { !it.dropped }} chats"
    run.kind == "build" -> buildLine(run)
    else -> "Job · ${run.branch}"
}

// "Build · 3 of 7 done · until 06:00", or what it waits for (web sessions/runLogic.ts buildLine).
fun buildLine(run: ChatRun): String {
    if (run.why.isNotEmpty()) return "Build · ${run.why}"
    val step = when (run.phase) {
        "spec" -> "writing the spec"
        "recap" -> "writing the recap"
        "more" -> "finding more work"
        else -> "${run.progress ?: "0 of 0"} done"
    }
    return "Build · $step" + (run.until?.let { " · until ${clock(it)}" } ?: "")
}

// The build chat's header line: "Task 4 of 7 · <task> · until 06:00", or the step it is on; null for other runs (web runLogic.ts buildHead).
fun buildHead(run: ChatRun): String? {
    if (run.kind != "build") return null
    val parts = run.progress.orEmpty().split(" of ").map { it.toIntOrNull() ?: 0 }
    val done = parts[0]
    val total = parts.getOrElse(1) { 0 }
    val step = when (run.phase) {
        "spec" -> "Writing the spec"
        "recap" -> "Writing the recap"
        "more" -> "Finding more work"
        else -> when {
            total == 0 -> "Starting"
            done >= total -> "All $total tasks done"
            else -> listOfNotNull("Task ${done + 1} of $total", run.task?.ifEmpty { null }).joinToString(" · ")
        }
    }
    return step + (run.until?.let { " · until ${clock(it)}" } ?: "")
}

// shared/build.ts APPROVE: a build run waiting for Build all.
const val BUILD_APPROVE = "Approve the spec: Build all"

fun firstRoundText(at: Long?) = "First round" + (at?.let { " ${clock(it)}" } ?: "")

fun nextRoundText(at: Long?) = "Next round" + (at?.let { " ${clock(it)}" } ?: "")

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

// The run card's first row (web composerLogic loopNow): the agent's status or the last round, whichever is newer.
data class LoopNow(val title: String, val at: Long?, val source: String, val next: String? = null, val stepsLeft: Int = 0)

fun loopNow(run: ChatRun, now: LiveNow?): LoopNow {
    val last = run.rounds.lastOrNull()
    if (now != null && now.at >= run.startedAt && (last == null || now.at >= last.at)) {
        return LoopNow(now.text, now.at, "status", next = now.next?.firstOrNull(), stepsLeft = now.next?.size ?: 0)
    }
    if (last != null) return LoopNow(roundSummary(last), null, "round")
    return LoopNow(firstRoundText(run.nextAt), null, "none")
}

// The meta line of the run card's first row (web runLogic nowMeta): the status time, the next step and the steps left.
fun nowMeta(now: LoopNow): String = listOfNotNull(
    now.at?.let { clock(it) },
    now.next?.let { "Next: $it" },
    now.stepsLeft.takeIf { it > 0 }?.let { "${plural(it, "step")} left" },
).joinToString(" · ")

fun stoppedText(run: ChatRun) = "${KIND[run.kind] ?: "Run"} stopped"

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

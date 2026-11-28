package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.BackgroundShell

// The composer's background list: running shells, then the finished ones, each with a muted duration ("Failed" in danger colour for a failed one, a muted "Stopped" for a stopped one) and opening to its command and output (web shared/backgroundShells.ts).
data class ShellRow(val toolUseId: String, val label: String, val time: String, val failed: Boolean, val detail: String)

data class ShellRows(val running: List<ShellRow>, val finished: List<ShellRow>)

fun shellDuration(ms: Long): String {
    val s = maxOf(0L, Math.round(ms / 1000.0))
    return when {
        s < 60 -> "${s}s"
        s < 3600 -> "${s / 60}m ${(s % 60).toString().padStart(2, '0')}s"
        else -> "${s / 3600}h ${((s % 3600) / 60).toString().padStart(2, '0')}m"
    }
}

fun shellRows(shells: List<BackgroundShell>, now: Long): ShellRows {
    fun row(t: BackgroundShell) = ShellRow(
        t.toolUseId,
        t.label.ifEmpty { t.command ?: "" }.ifEmpty { "Shell command" },
        if (t.failed) "Failed" else if (t.stopped) "Stopped" else shellDuration((t.endedAt ?: now) - t.startedAt),
        t.failed,
        listOfNotNull(t.command?.takeIf { it.isNotEmpty() }?.let { "$ $it" }, t.output?.takeIf { it.isNotEmpty() } ?: if (t.endedAt != null) "No output" else "No output yet", t.exitCode?.takeIf { t.failed }?.let { "[exited with code $it]" }, "[killed]".takeIf { t.stopped }).joinToString("\n"),
    )
    return ShellRows(shells.filter { it.endedAt == null }.map(::row), shells.filter { it.endedAt != null }.map(::row))
}

package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.net.SpawnedBuild
import no.pradhan.agentview.nativeapp.workspace.specSlug

const val BUILD_TOOL = "mcp__agentview__start_build"

sealed interface BuildCardOpen {
    data class Chat(val id: String) : BuildCardOpen
    data class Session(val id: String) : BuildCardOpen
}

data class BuildCardText(val title: String, val status: String, val tasks: String, val round: String, val open: BuildCardOpen?, val found: Boolean)

private val STATUS = mapOf(
    "spec" to "Writing spec",
    "approval" to "Waiting for approval",
    "running" to "Running",
    "paused" to "Paused",
    "needs" to "Needs you",
    "done" to "Done",
    "stopped" to "Stopped",
)

private val newChat = Regex("new chat \\(([^)]+)\\)")

private fun taskText(b: SpawnedBuild) = when {
    b.total == 0 -> ""
    b.state == "done" || b.state == "stopped" -> "${b.done} of ${b.total} tasks"
    b.state == "running" || b.state == "needs" || b.state == "paused" -> "Task ${minOf(b.done + 1, b.total)} of ${b.total}"
    else -> "${b.total} tasks"
}

// web buildCardLogic.ts buildCard: the card for the index-th start_build call, matched by the chat id its result names, else by order.
fun buildCard(spec: String, request: String, result: String?, index: Int, builds: List<SpawnedBuild>): BuildCardText {
    val title = if (spec.isNotEmpty()) specSlug(spec) else request.split(Regex("\\s+")).filter { it.isNotEmpty() }.take(6).joinToString(" ")
    val chat = result?.let { newChat.find(it)?.groupValues?.get(1) }
    val build = chat?.let { c -> builds.find { it.chatId == c } } ?: builds.getOrNull(index)
        ?: return BuildCardText(title, result ?: "Starting", "", "", chat?.let { BuildCardOpen.Chat(it) }, false)
    return BuildCardText(
        title,
        STATUS[build.state] ?: build.state,
        taskText(build),
        build.round ?: "",
        build.chatId?.let { BuildCardOpen.Chat(it) } ?: BuildCardOpen.Session(build.sessionId),
        true,
    )
}

data class BuildRow(val sessionId: String, val chatId: String?, val title: String, val status: String, val needs: Boolean, val meta: String)

// web buildCardLogic.ts buildRows: the open builds a chat started, as indented rows under its Sessions row.
fun buildRows(builds: List<SpawnedBuild>) = builds.filter { it.state != "done" && it.state != "stopped" }.map { b ->
    BuildRow(b.sessionId, b.chatId, b.title.ifEmpty { "Build" }, STATUS[b.state] ?: b.state, b.state == "needs" || b.state == "approval", listOf(taskText(b), b.round.orEmpty()).filter { it.isNotEmpty() }.joinToString(" · "))
}

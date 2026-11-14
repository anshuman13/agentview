package no.pradhan.agentview.nativeapp.app

import no.pradhan.agentview.nativeapp.chat.Tone2
import no.pradhan.agentview.nativeapp.chat.statusLine
import no.pradhan.agentview.nativeapp.net.LiveChat
import no.pradhan.agentview.nativeapp.ops.McpServer
import no.pradhan.agentview.nativeapp.ops.mcpHideKey
import no.pradhan.agentview.nativeapp.sessions.ChatState
import no.pradhan.agentview.nativeapp.sessions.chatState

// shared/counts.ts: every badge number in the app, from the chats, the MCP servers and the row counts the Codex logic gives.
data class CountChat(val id: String, val state: ChatState?, val tone: Tone2, val runNeeds: Boolean, val agents: Int)

data class McpCounts(val connected: Int = 0, val total: Int = 0, val needsYou: Int = 0)

data class AppCounts(val needsYou: Int = 0, val chats: Int = 0, val waiting: Int = 0, val running: Int = 0, val agents: Int = 0, val mcp: McpCounts = McpCounts())

fun countChat(c: LiveChat, seen: Map<String, Long>) = CountChat(c.id, chatState(c, null, seen), statusLine(c, null).tone, c.run?.needsYou == true, c.agentList.size)

val CountChat.waits get() = tone == Tone2.Needs || runNeeds

private val MCP_BAD = setOf("failed", "needs-auth")

private fun shownMcp(mcp: List<McpServer>, hidden: Map<String, String>) = mcp.filter { hidden[mcpHideKey(it.name)] != "hidden" }

// attention mirrors shared/counts.ts for the shared fixture; the app passes 0, as only web reads the attention message.
fun appCounts(chats: List<CountChat>, viewing: String, attention: Int, mcp: List<McpServer>, hidden: Map<String, String>, needsYouRows: Int, replyRows: Int): AppCounts {
    val servers = shownMcp(mcp, hidden)
    return AppCounts(
        needsYou = needsYouRows + replyRows,
        chats = chats.count { it.id != viewing && (it.state == ChatState.Needs || it.state == ChatState.Done) } + attention,
        waiting = chats.count { it.waits },
        running = chats.count { !it.waits && it.tone == Tone2.Running },
        agents = chats.firstOrNull { it.id == viewing }?.agents ?: 0,
        mcp = McpCounts(servers.count { it.status == "connected" }, servers.size, servers.count { it.status in MCP_BAD }),
    )
}

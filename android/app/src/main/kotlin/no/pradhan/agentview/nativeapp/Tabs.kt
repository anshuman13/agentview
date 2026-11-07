package no.pradhan.agentview.nativeapp

enum class Tab(val route: String, val label: String) {
    Codex("assistant", "Codex"),
    Chat("chat", "Chat"),
    Sessions("sessions", "Sessions"),
    Agents("agents", "Agents"),
}

class MoreItem(val route: String, val label: String)

val MORE_TOOLS = listOf(
    MoreItem("files", "Files"),
    MoreItem("browser", "Browser"),
    MoreItem("terminal", "Terminal"),
    MoreItem("changes", "Source Control"),
    MoreItem("github", "Pull Requests"),
)
val MORE_PAGES = listOf(
    MoreItem("observe", "Observe"),
    MoreItem("deploy", "Deploy"),
    MoreItem("mcp", "MCP Servers"),
    MoreItem("settings", "Settings"),
)

fun routeFor(link: DeepLink): String? = when {
    link.chat != null || link.session != null -> Tab.Chat.route
    link.page != null -> "more/${link.page}"
    else -> when (link.view) {
        "assistant" -> Tab.Codex.route
        "chats", "sessions" -> Tab.Sessions.route
        "explorer" -> "more/files"
        "changes", "github" -> "more/${link.view}"
        else -> null
    }
}

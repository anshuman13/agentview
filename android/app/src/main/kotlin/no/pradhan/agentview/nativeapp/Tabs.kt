package no.pradhan.agentview.nativeapp

enum class Tab(val route: String, val label: String) {
    Codex("assistant", "Codex"),
    Chat("chat", "Chat"),
    Sessions("sessions", "Sessions"),
}

class MoreItem(val route: String, val label: String, val icon: String)

val MORE_TOOLS = listOf(
    MoreItem("files", "Files", "files"),
    MoreItem("browser", "Browser", "globe"),
    MoreItem("terminal", "Terminal", "terminal"),
    MoreItem("changes", "Source Control", "source-control"),
    MoreItem("github", "Pull Requests", "github"),
)
val MORE_PAGES = listOf(
    MoreItem("observe", "Observe", "pulse"),
    MoreItem("deploy", "Deploy", "rocket"),
    MoreItem("mcp", "MCP Servers", "plug"),
    MoreItem("settings", "Settings", "settings-gear"),
)

fun routeFor(link: DeepLink): String? = when {
    link.action == Shortcut.ADD_TASK -> Tab.Codex.route
    link.action == Shortcut.NEW_CHAT -> Tab.Chat.route
    link.chat != null || link.session != null -> Tab.Chat.route
    link.page != null -> "more/${link.page}"
    else -> when (link.view) {
        "assistant" -> Tab.Codex.route
        "agents" -> Tab.Chat.route
        "chats", "sessions" -> Tab.Sessions.route
        "explorer" -> "more/files"
        "changes", "github" -> "more/${link.view}"
        else -> null
    }
}

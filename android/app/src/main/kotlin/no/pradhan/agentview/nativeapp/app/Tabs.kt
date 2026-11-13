package no.pradhan.agentview.nativeapp.app

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
    MoreItem("github", "Pull Requests", "git-pull-request"),
)
val MORE_PAGES = listOf(
    MoreItem("advisors", "Advisors", "organization"),
    MoreItem("runs", "Runs", "sync"),
    MoreItem("sketches", "Sketches", "paintcan"),
    MoreItem("observe", "Observe", "pulse"),
    MoreItem("deploy", "Deploy", "rocket"),
    MoreItem("mcp", "MCP Servers", "plug"),
    MoreItem("settings", "Settings", "settings-gear"),
)

fun morePages(deploy: Boolean, hidden: Collection<String>) = MORE_PAGES.filter { (it.route != "deploy" || deploy) && shownFeature("page:${it.route}", hidden) }

fun moreTools(hidden: Collection<String>) = MORE_TOOLS.filter { shownFeature("more:${it.route}", hidden) }

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
        "changes", "github", "runs" -> "more/${link.view}"
        else -> null
    }
}

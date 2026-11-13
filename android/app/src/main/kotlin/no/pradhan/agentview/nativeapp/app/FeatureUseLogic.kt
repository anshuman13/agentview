package no.pradhan.agentview.nativeapp.app

import java.time.LocalDate

// shared/featureUse.ts: the catalogue and the never used and used split, without the palette helper (the phone has no palette).
class Feature(val id: String, val label: String, val kind: String, val hideable: Boolean)

class UsedFeature(val feature: Feature, val n7: Int, val n30: Int, val last: String)

class FeatureRows(val never: List<Feature>, val used: List<UsedFeature>)

private fun make(kind: String, hideable: (String) -> Boolean, vararg rows: Pair<String, String>) = rows.map { (id, label) -> Feature("$kind:$id", label, kind, hideable(id)) }

private val PALETTE = make(
    "palette",
    { true },
    "view:explorer" to "Show Explorer", "view:changes" to "Show Source Control", "view:github" to "Show Pull Requests", "view:chats" to "Show Sessions", "view:sessions" to "Show Workspace", "view:runs" to "Show Runs",
    "tab:chat" to "Tab: Chat", "tab:code" to "Tab: Files", "tab:term" to "Tab: Terminal", "tab:browser" to "Tab: Browser", "tab:agents" to "Tab: Agents",
    "codex:today" to "Codex: Overview", "codex:tasks" to "Codex: Tasks", "codex:meetings" to "Codex: Meetings", "codex:jobs" to "Codex: Jobs", "codex:wiki" to "Codex: Wiki", "codex:summary" to "Codex: Slack summary", "codex:goals" to "Codex: All goals", "codex:search" to "Codex: Search", "codex:newtask" to "Codex: New task",
    "terminal" to "Toggle Terminal", "switchEditor" to "Switch File and Browser", "toggleSidebar" to "Toggle Left Sidebar", "toggleChat" to "Toggle Chat", "file" to "Go to File", "repo" to "Open Repository",
    "forkChat" to "Fork Chat", "compact" to "Compact Context", "loop" to "Toggle Build Cycle", "review" to "Toggle Review Changes", "goal" to "New goal", "goalFile" to "Run file as goal", "spec" to "Start with a spec", "stop" to "Stop the Agent",
    "theme" to "Toggle Theme", "notify" to "Toggle Notifications", "shortcuts" to "Keyboard shortcuts", "phone" to "Open on Phone", "restart" to "Restart Server When Agents Are Idle",
    "model" to "Pick a model", "effort" to "Pick an effort", "mode" to "Pick a permission mode", "newChat" to "New chat", "open" to "Open a chat, task, meeting or wiki page",
)

val FEATURES: List<Feature> =
    make("page", { it != "settings" }, "advisors" to "Advisors", "observe" to "Observe", "deploy" to "Deploy", "mcp" to "MCP Servers", "sketches" to "Sketches", "settings" to "Settings") +
        make("tab", { false }, "codex" to "Codex", "chat" to "Chat", "sessions" to "Sessions", "agents" to "Agents") +
        make("list", { false }, "overview" to "Overview", "tasks" to "Tasks", "meetings" to "Meetings", "jobs" to "Jobs", "wiki" to "Wiki") +
        PALETTE +
        make("sheet", { false }, "goal" to "Goal sheet", "needsYou" to "Needs you", "more" to "More") +
        make("more", { true }, "files" to "Files", "browser" to "Browser", "terminal" to "Terminal", "changes" to "Source Control", "github" to "Pull Requests") +
        make("action", { it == "runAll" || it == "runAsGoal" }, "startGoal" to "Start a goal", "approveRun" to "Approve a run", "approveSpec" to "Approve a spec phase", "runAll" to "Run all spec tasks", "runAsGoal" to "Run a spec as a goal", "startTask" to "Start a spec task")

private val FEATURE_BY_ID = FEATURES.associateBy { it.id }

fun shownFeature(id: String, hidden: Collection<String>) = id !in hidden

// Recording needs the setting on, a writable app and an id the server knows.
fun shouldTrack(on: Boolean, readOnly: Boolean, id: String) = on && !readOnly && id in FEATURE_BY_ID

private fun dayNumber(day: String) = LocalDate.parse(day).toEpochDay()

// Features with no count in the kept days, and the rest by uses in the last window days (fewest first), then by label.
fun featureRows(days: Map<String, Map<String, Int>>, today: String, window: Int): FeatureRows {
    val rows = LinkedHashMap<String, UsedFeature>()
    val at = dayNumber(today)
    for ((day, counts) in days) {
        val age = at - dayNumber(day)
        for ((id, n) in counts) {
            val f = FEATURE_BY_ID[id] ?: continue
            if (n <= 0) continue
            val row = rows[id]
            rows[id] = UsedFeature(f, (row?.n7 ?: 0) + if (age < 7) n else 0, (row?.n30 ?: 0) + if (age < 30) n else 0, maxOf(row?.last ?: day, day))
        }
    }
    val count = { r: UsedFeature -> if (window == 7) r.n7 else r.n30 }
    return FeatureRows(
        FEATURES.filter { it.id !in rows }.sortedBy { it.label },
        rows.values.sortedWith(compareBy<UsedFeature> { count(it) }.thenBy { it.feature.label }),
    )
}

fun lastUsed(day: String, today: String) = (dayNumber(today) - dayNumber(day)).let { if (it == 0L) "today" else "${it}d ago" }

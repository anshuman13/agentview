package no.pradhan.agentview.nativeapp.net

// shared/providers.ts: what each provider fixes, its name, how its use is billed and its permission modes.
// The cases in shared/fixtures/providers.json run against both.
class ModeOption(val value: String, val label: String, val detail: String)

private val CLAUDE_MODES = listOf(
    ModeOption("default", "Default", "Ask before edits and risky commands"),
    ModeOption("acceptEdits", "Accept edits", "Edit files without asking, ask for the rest"),
    ModeOption("plan", "Plan", "Read and plan, no edits"),
    ModeOption("auto", "Auto", "Claude runs what is safe and asks only for risky actions"),
    ModeOption("dontAsk", "Don't ask", "Deny anything not pre-approved"),
)

private val CODEX_MODES = listOf(
    ModeOption("default", "Default", "Ask before edits and commands"),
    ModeOption("auto", "Auto", "Edit and run commands, network on"),
    ModeOption("readOnly", "Read only", "Read files, no edits"),
)

// A chat with no provider runs on Claude.
fun providerLabel(p: String?) = when (p) { "openrouter" -> "OpenRouter"; "codex" -> "Codex"; else -> "Claude" }

fun billing(p: String?) = when (p) { "openrouter" -> "none"; "codex" -> "plan"; else -> "usd" }

// What a cost shows for a provider that is not billed in dollars; null for one that is.
fun unbilledText(billing: String) = when (billing) { "plan" -> "Plan"; "none" -> "-"; else -> null }

// The mark a row shows before its time for a chat that is not on Claude.
fun providerMark(p: String?) = if (p == null || p == "claude") null else providerLabel(p)

fun providerModes(p: String?) = if (p == "codex") CODEX_MODES else CLAUDE_MODES

private val SUPERVISED = ModeOption("supervised", "Supervised", "Auto, and review each turn")

class MenuModes(val list: List<ModeOption>, val checked: String, val label: String)

// The mode list the pick menus show: Supervised (auto with review each turn) follows Auto. The palette and new chats use providerModes.
fun menuModes(p: String?, mode: String, review: Boolean): MenuModes {
    val modes = providerModes(p)
    val at = modes.indexOfFirst { it.value == "auto" } + 1
    val supervised = mode == "auto" && review
    val name = modes.firstOrNull { it.value == mode }?.label ?: mode
    return MenuModes(modes.take(at) + SUPERVISED + modes.drop(at), if (supervised) SUPERVISED.value else mode, if (supervised) SUPERVISED.label else if (review) "$name · Review" else name)
}

// What picking a row of the menu sends: a permission mode and a review switch, each null when it already holds.
fun modeSteps(mode: String, review: Boolean, picked: String): Pair<String?, Boolean?> = when {
    picked == menuModes(null, mode, review).checked -> null to null
    picked == SUPERVISED.value -> (if (mode == "auto") null else "auto") to (if (review) null else true)
    else -> (if (picked == mode) null else picked) to (if (review) false else null)
}

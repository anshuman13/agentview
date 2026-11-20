package no.pradhan.agentview.nativeapp.ui

private val SHELLS = setOf("bash", "sh", "shell", "zsh", "console")
private val SHELL_PROMPT = Regex("""^\$(\s+|$)""")
private val CONTROL = Regex("[\\x00-\\x08\\x0a-\\x1f\\x7f]")

// shared/composerText.ts shellLine: the command of a one-line shell block in a reply, without a leading "$ " prompt.
fun shellLine(lang: String?, code: String): String? {
    if ((lang ?: "").trim().split(Regex("\\s+"))[0].lowercase() !in SHELLS) return null
    val lines = code.trim().split('\n')
    return if (lines.size == 1) lines[0].replace(SHELL_PROMPT, "").trim().ifEmpty { null }?.takeUnless { CONTROL.containsMatchIn(it) } else null
}

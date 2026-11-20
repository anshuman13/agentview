package no.pradhan.agentview.nativeapp.net

private val NETWORK = Regex("^(failed to fetch|load failed|networkerror|failed to connect|unable to resolve host)", RegexOption.IGNORE_CASE)
private val TIMEOUT = Regex("\\btimed? ?out\\b", RegexOption.IGNORE_CASE)

// A load or write error in plain words (shared/loadError.ts): a dropped link or a Mac that stopped answering; the server's own text is kept.
fun loadErrorText(raw: String) = when {
    NETWORK.containsMatchIn(raw) -> "Can't reach the Mac"
    TIMEOUT.containsMatchIn(raw) -> "The Mac took too long to answer"
    else -> raw
}

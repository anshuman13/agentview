package no.pradhan.agentview.nativeapp.ui

import java.net.URLDecoder

data class FilePath(val path: String, val line: Int? = null)

private val FILE_PATH = Regex("""((?:~|\.{1,2})?/?[^\s:*?"<>|`]*\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d+)(?::\d+)?|#L(\d+))?""")
private val URL_SCHEME = Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE)
private val BARE_FILE = Regex("""\.(md|markdown|mdx|csv|tsv)$""", RegexOption.IGNORE_CASE)

// A file path a reply names (web filePath in md.ts), checked by shared/fixtures/file-path.json.
fun filePath(text: String): FilePath? {
    val m = FILE_PATH.matchEntire(text.trim()) ?: return null
    val path = m.groupValues[1]
    if (URL_SCHEME.containsMatchIn(text) || "//" in path) return null
    if ('/' !in path && !BARE_FILE.containsMatchIn(path)) return null
    val line = (m.groups[2] ?: m.groups[3])?.value?.toIntOrNull()?.takeIf { it > 0 }
    return FilePath(path.removePrefix("./"), line)
}

// A link target percent-decoded like web decodeURI, or as written when it is not valid encoding.
fun decodedTarget(url: String): String = runCatching { URLDecoder.decode(url.replace("+", "%2B"), "UTF-8") }.getOrDefault(url)

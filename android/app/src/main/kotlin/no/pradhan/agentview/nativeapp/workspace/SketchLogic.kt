package no.pradhan.agentview.nativeapp.workspace

import kotlinx.serialization.Serializable

// Mirrors shared/sketches.ts.
private val SKETCH_PATH = Regex("(?:^|/)\\.claude/sketches/[^/]+\\.html$")

fun isSketchPath(path: String) = SKETCH_PATH.containsMatchIn(path)

fun sketchName(path: String) = path.substring(path.lastIndexOf('/') + 1)

fun sketchTitle(name: String) = name.removeSuffix(".html")

// The page and the deep link open only a name the list returned.
fun sketchOpenable(name: String, listed: List<String>) = '/' !in name && name.isNotEmpty() && name in listed

// The list shows a search box once it holds more than this many sketches.
const val SKETCH_SEARCH_MIN = 6

private val DASHES = Regex("[-_]+")

// A sketch matches when every word of the query is in its title, with dashes and underscores read as spaces.
fun sketchMatches(name: String, query: String): Boolean {
    val title = sketchTitle(name).lowercase().replace(DASHES, " ")
    return query.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }.all { title.contains(it.replace(DASHES, " ")) }
}

// The file name a rename asks for: the typed title plus .html, or null when it is empty, hidden or names a folder.
fun sketchRename(input: String): String? {
    val title = sketchTitle(input.trim()).trim()
    return if (title.isEmpty() || title.startsWith('.') || title.any { it == '/' || it == '\\' || it == '\u0000' }) null else "$title.html"
}

const val MAX_SKETCH = 1_000_000

const val SKETCH_WIDE = 1280

@Serializable
data class SketchFile(val name: String, val path: String, val mtime: Double = 0.0)

private const val GUARD = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\"><base target=\"_blank\">"

private val META = Regex("<meta\\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>", RegexOption.IGNORE_CASE)
private val HTTP_EQUIV = Regex("\\bhttp-equiv\\b", RegexOption.IGNORE_CASE)
private val VIEWPORT = Regex("\\bname\\s*=\\s*[\"']?viewport\\b", RegexOption.IGNORE_CASE)
private val TARGET = Regex("([\\s/\"'])target\\s*=", RegexOption.IGNORE_CASE)
private val DOCTYPE = Regex("^\\s*<!doctype[^>]*>", RegexOption.IGNORE_CASE)

// The page a sketch frame shows: our own html and head come first, so the policy applies to everything the file adds. http-equiv metas
// (refresh) are removed and target attributes renamed, so no link or form can navigate the frame.
fun sketchDoc(html: String, theme: String): String {
    val clean = html.replace(META) { if (HTTP_EQUIV.containsMatchIn(it.value)) "" else it.value }.replace(TARGET, "$1data-target=")
    val doctype = DOCTYPE.find(clean)?.value ?: ""
    return "$doctype<html data-theme=\"$theme\"><head>$GUARD</head>${clean.substring(doctype.length)}"
}

// A WebView without scripts shows a page at 980px unless a viewport meta says otherwise; the desktop frame asks for 1280 in our own
// head, after the file's own viewport metas are removed.
fun sketchPage(html: String, theme: String, desktop: Boolean): String {
    if (!desktop) return sketchDoc(html, theme)
    val own = html.replace(META) { if (VIEWPORT.containsMatchIn(it.value)) "" else it.value }
    return sketchDoc(own, theme).replaceFirst("</head>", "<meta name=\"viewport\" content=\"width=$SKETCH_WIDE\"></head>")
}

// The WebView settings a sketch frame needs off, so tests can check them without a WebView.
interface SketchSettings {
    var javaScript: Boolean
    var blockNetwork: Boolean
    var fileAccess: Boolean
    var contentAccess: Boolean
}

fun lockSketch(s: SketchSettings) {
    s.javaScript = false
    s.blockNetwork = true
    s.fileAccess = false
    s.contentAccess = false
}

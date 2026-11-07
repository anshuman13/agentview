package no.pradhan.agentview.nativeapp

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

// web/src/workspace/Explorer.tsx: the tree is the listed folders walked from the root, expanded folders inline.
@Serializable
data class DirEntry(val name: String, val dir: Boolean = false, val hidden: Boolean = false)

data class TreeRow(val name: String, val path: String, val dir: Boolean, val hidden: Boolean, val depth: Int)

@Serializable
data class FileData(val content: String = "", val original: String = "", val image: Boolean = false, val binary: Boolean = false, val error: String? = null)

fun parseDir(body: String): List<DirEntry> = protocolJson.decodeFromString(ListSerializer(DirEntry.serializer()), body)
fun parseFile(body: String): FileData = protocolJson.decodeFromString(FileData.serializer(), body)

fun parentOf(path: String) = path.substringBeforeLast('/', "")

// The visible rows and the folders that are open but not listed yet.
fun treeRows(dirs: Map<String, List<DirEntry>>, expanded: Set<String>, showHidden: Boolean): Pair<List<TreeRow>, List<String>> {
    val rows = mutableListOf<TreeRow>()
    val missing = mutableListOf<String>()
    fun walk(p: String, depth: Int) {
        val list = dirs[p] ?: run { missing += p; return }
        for (e in list) {
            if (e.hidden && !showHidden) continue
            val path = if (p.isEmpty()) e.name else "$p/${e.name}"
            rows += TreeRow(e.name, path, e.dir, e.hidden, depth)
            if (e.dir && path in expanded) walk(path, depth + 1)
        }
    }
    walk("", 0)
    return rows to missing
}

fun fileError(error: String) = if (error == "path outside project") "This file is outside the project folder" else error

// web/src/workspace/FileIcon.tsx colours, by name then extension.
enum class FileHue { Blue, Yellow, Purple, Orange, Green, Red, Pink, Cyan, Gray, Folder }

private val HUE_BY_NAME = mapOf(
    "package.json" to FileHue.Green, "package-lock.json" to FileHue.Gray, "yarn.lock" to FileHue.Gray, "pnpm-lock.yaml" to FileHue.Gray,
    "cargo.lock" to FileHue.Gray, "poetry.lock" to FileHue.Gray, "uv.lock" to FileHue.Gray, "go.sum" to FileHue.Gray,
    "dockerfile" to FileHue.Blue, "makefile" to FileHue.Gray, "license" to FileHue.Yellow,
)

private val HUE_BY_EXT = listOf(
    Regex("^readme\\.mdx?$", RegexOption.IGNORE_CASE) to FileHue.Blue,
    Regex("\\.mdx?$", RegexOption.IGNORE_CASE) to FileHue.Blue,
    Regex("\\.tsx?$", RegexOption.IGNORE_CASE) to FileHue.Blue,
    Regex("\\.(jsx?|mjs|cjs)$", RegexOption.IGNORE_CASE) to FileHue.Yellow,
    Regex("\\.json[c5]?$", RegexOption.IGNORE_CASE) to FileHue.Yellow,
    Regex("\\.(css|scss|sass|less)$", RegexOption.IGNORE_CASE) to FileHue.Purple,
    Regex("\\.(html?|vue|svelte|astro)$", RegexOption.IGNORE_CASE) to FileHue.Orange,
    Regex("\\.py$", RegexOption.IGNORE_CASE) to FileHue.Blue,
    Regex("\\.go$", RegexOption.IGNORE_CASE) to FileHue.Cyan,
    Regex("\\.(rs|swift)$", RegexOption.IGNORE_CASE) to FileHue.Orange,
    Regex("\\.kts?$", RegexOption.IGNORE_CASE) to FileHue.Purple,
    Regex("\\.(java|rb|c|cc|cpp|h|hpp|cs)$", RegexOption.IGNORE_CASE) to FileHue.Red,
    Regex("\\.(sh|bash|zsh|fish|bat|ps1)$", RegexOption.IGNORE_CASE) to FileHue.Green,
    Regex("\\.ya?ml$", RegexOption.IGNORE_CASE) to FileHue.Purple,
    Regex("\\.sql$", RegexOption.IGNORE_CASE) to FileHue.Pink,
    Regex("\\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)$", RegexOption.IGNORE_CASE) to FileHue.Purple,
    Regex("\\.pdf$", RegexOption.IGNORE_CASE) to FileHue.Red,
    Regex("\\.(xml|plist|graphql|gql|prisma|proto)$", RegexOption.IGNORE_CASE) to FileHue.Orange,
)

fun fileHue(name: String): FileHue {
    val base = name.substringAfterLast('/').lowercase()
    HUE_BY_NAME[base]?.let { return it }
    HUE_BY_NAME[base.substringBefore('.')]?.let { return it }
    return HUE_BY_EXT.firstOrNull { it.first.containsMatchIn(base) }?.second ?: FileHue.Gray
}

// The short tag shown as a file's icon: its extension, or the first letters of a dotfile or extensionless name.
fun fileTag(name: String): String {
    val base = name.substringAfterLast('/')
    val ext = base.substringAfterLast('.', "")
    return (if (ext.isNotEmpty() && base.indexOf('.') > 0) ext else base.trimStart('.')).take(3).lowercase()
}

fun isMarkdown(path: String) = Regex("\\.(md|markdown|mdx)$", RegexOption.IGNORE_CASE).containsMatchIn(path)

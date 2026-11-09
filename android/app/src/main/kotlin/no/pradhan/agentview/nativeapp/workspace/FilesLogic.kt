package no.pradhan.agentview.nativeapp.workspace

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import no.pradhan.agentview.nativeapp.net.image
import no.pradhan.agentview.nativeapp.net.protocolJson

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

private class Kind(val hue: FileHue, val label: String? = null)

private fun re(p: String) = Regex(p, RegexOption.IGNORE_CASE)

private val BY_NAME = mapOf(
    "package.json" to Kind(FileHue.Green, "json"), "package-lock.json" to Kind(FileHue.Gray, "json"),
    "yarn.lock" to Kind(FileHue.Gray, "lock"), "pnpm-lock.yaml" to Kind(FileHue.Gray, "lock"), "cargo.lock" to Kind(FileHue.Gray, "lock"),
    "poetry.lock" to Kind(FileHue.Gray, "lock"), "uv.lock" to Kind(FileHue.Gray, "lock"), "go.sum" to Kind(FileHue.Gray, "lock"),
    "dockerfile" to Kind(FileHue.Blue, "docker"), "makefile" to Kind(FileHue.Gray, "make"), "license" to Kind(FileHue.Yellow, "lic"),
    ".gitignore" to Kind(FileHue.Gray, "git"), ".gitattributes" to Kind(FileHue.Gray, "git"),
    ".npmrc" to Kind(FileHue.Gray, "cfg"), ".nvmrc" to Kind(FileHue.Gray, "cfg"), ".editorconfig" to Kind(FileHue.Gray, "cfg"),
    ".prettierrc" to Kind(FileHue.Gray, "cfg"), ".eslintrc" to Kind(FileHue.Gray, "cfg"),
    "procfile" to Kind(FileHue.Gray, "proc"),
)

private val BARE = mapOf("readme" to Kind(FileHue.Gray, "readme"), "changelog" to Kind(FileHue.Gray, "log"))

private val BY_EXT = listOf(
    re("^readme\\.mdx?$") to Kind(FileHue.Blue, "readme"),
    re("\\.mdx?$") to Kind(FileHue.Blue, "md"),
    re("\\.tsx?$") to Kind(FileHue.Blue),
    re("\\.(jsx?|mjs|cjs)$") to Kind(FileHue.Yellow),
    re("\\.json[c5]?$") to Kind(FileHue.Yellow, "json"),
    re("\\.(css|scss|sass|less)$") to Kind(FileHue.Purple),
    re("\\.(html?|vue|svelte|astro)$") to Kind(FileHue.Orange),
    re("\\.py$") to Kind(FileHue.Blue),
    re("\\.go$") to Kind(FileHue.Cyan),
    re("\\.rs$") to Kind(FileHue.Orange),
    re("\\.swift$") to Kind(FileHue.Orange),
    re("\\.kts?$") to Kind(FileHue.Purple),
    re("\\.(java|rb|c|cc|cpp|h|hpp|cs)$") to Kind(FileHue.Red),
    re("\\.(sh|bash|zsh|fish|bat|ps1)$") to Kind(FileHue.Green),
    re("\\.ya?ml$") to Kind(FileHue.Purple, "yaml"),
    re("\\.(toml|ini|cfg|conf|properties)$") to Kind(FileHue.Gray, "cfg"),
    re("\\.sql$") to Kind(FileHue.Pink),
    re("\\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)$") to Kind(FileHue.Purple, "img"),
    re("\\.pdf$") to Kind(FileHue.Red),
    re("\\.(zip|tar|gz|tgz|bz2|7z|rar)$") to Kind(FileHue.Gray, "zip"),
    re("\\.(lock|lockb)$") to Kind(FileHue.Gray, "lock"),
    re("\\.env(\\..*)?$") to Kind(FileHue.Gray, "env"),
    re("\\.(txt|log|csv)$") to Kind(FileHue.Gray),
    re("\\.(xml|plist|graphql|gql|prisma|proto)$") to Kind(FileHue.Orange),
)

private fun fileKind(name: String): Pair<Kind?, String> {
    val base = name.substringAfterLast('/').lowercase()
    val kind = BY_NAME[base] ?: BY_NAME[base.substringBefore('.')] ?: BY_EXT.firstOrNull { it.first.containsMatchIn(base) }?.second ?: BARE[base]
    return kind to base
}

fun fileHue(name: String) = fileKind(name).first?.hue ?: FileHue.Gray

// The short whole-word label shown as a file's icon.
fun fileTag(name: String): String {
    val (kind, base) = fileKind(name)
    kind?.label?.let { return it }
    val ext = if (base.indexOf('.') > 0) base.substringAfterLast('.') else ""
    return if (ext.isNotEmpty() && (kind != null || ext.length <= 4)) ext else "file"
}

fun isMarkdown(path: String) = Regex("\\.(md|markdown|mdx)$", RegexOption.IGNORE_CASE).containsMatchIn(path)

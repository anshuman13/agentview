package no.pradhan.agentview.nativeapp.workspace

import no.pradhan.agentview.nativeapp.ui.Type

// A line-based syntax highlighter for the file view: comments, strings, numbers, keywords, types and keys,
// coloured with the --syn-* tokens the web editor uses.
enum class Syn { Keyword, Str, Num, Comment, Type, Property }

data class SynSpan(val start: Int, val end: Int, val syn: Syn)

enum class Lang { CLike, Python, Shell, Json, Yaml, Css, Sql, Plain }

fun langOf(path: String): Lang {
    val name = path.substringAfterLast('/').lowercase()
    val ext = name.substringAfterLast('.', "")
    return when {
        ext in setOf("kt", "kts", "ts", "tsx", "js", "jsx", "mjs", "cjs", "java", "go", "rs", "swift", "c", "cc", "cpp", "h", "hpp", "cs", "scala", "dart", "gradle") -> Lang.CLike
        ext in setOf("py", "pyi", "rb", "toml") || name == "dockerfile" -> Lang.Python
        ext in setOf("sh", "bash", "zsh", "fish") || name == "makefile" || name.startsWith(".env") -> Lang.Shell
        ext in setOf("json", "jsonc", "json5") -> Lang.Json
        ext in setOf("yml", "yaml") -> Lang.Yaml
        ext in setOf("css", "scss", "less") -> Lang.Css
        ext == "sql" -> Lang.Sql
        else -> Lang.Plain
    }
}

private val CLIKE_KEYWORDS = setOf(
    "abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "data", "default", "defer", "delete", "do", "else",
    "enum", "export", "extends", "false", "final", "finally", "fn", "for", "from", "fun", "func", "function", "go", "if", "impl", "implements", "import",
    "in", "instanceof", "interface", "internal", "is", "let", "match", "mod", "mut", "new", "nil", "null", "object", "open", "override", "package",
    "private", "protected", "pub", "public", "return", "sealed", "self", "static", "struct", "super", "suspend", "switch", "this", "throw", "throws",
    "trait", "true", "try", "type", "typeof", "undefined", "use", "val", "var", "void", "when", "where", "while", "yield",
)
private val PY_KEYWORDS = setOf(
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from",
    "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield",
    "FROM", "RUN", "COPY", "ADD", "WORKDIR", "ENV", "ARG", "CMD", "ENTRYPOINT", "EXPOSE", "USER", "end", "do", "then", "module", "require",
)
private val SH_KEYWORDS = setOf("if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "function", "return", "export", "local", "set", "unset", "echo", "exit")
private val SQL_KEYWORDS = setOf(
    "select", "from", "where", "and", "or", "not", "insert", "into", "values", "update", "set", "delete", "create", "table", "alter", "drop", "index",
    "join", "left", "right", "inner", "outer", "on", "group", "by", "order", "having", "limit", "offset", "as", "distinct", "null", "is", "in", "case",
    "when", "then", "else", "end", "with", "union", "all", "primary", "key", "foreign", "references", "default", "true", "false",
)
private val LITERALS = setOf("true", "false", "null")

private fun keywordsOf(lang: Lang) = when (lang) {
    Lang.CLike -> CLIKE_KEYWORDS
    Lang.Python -> PY_KEYWORDS
    Lang.Shell -> SH_KEYWORDS
    Lang.Json, Lang.Yaml -> LITERALS
    else -> emptySet()
}

private fun lineComment(lang: Lang) = when (lang) {
    Lang.CLike -> "//"
    Lang.Python, Lang.Shell, Lang.Yaml -> "#"
    Lang.Sql -> "--"
    else -> null
}

private fun blockComments(lang: Lang) = lang == Lang.CLike || lang == Lang.Css || lang == Lang.Sql

// The spans of one line, and whether a block comment is still open at its end.
fun highlightLine(line: String, lang: Lang, inBlock: Boolean = false): Pair<List<SynSpan>, Boolean> {
    if (lang == Lang.Plain) return emptyList<SynSpan>() to false
    val out = mutableListOf<SynSpan>()
    val keywords = keywordsOf(lang)
    val comment = lineComment(lang)
    var i = 0
    val n = line.length
    if (inBlock) {
        val end = line.indexOf("*/")
        if (end < 0) return listOf(SynSpan(0, n, Syn.Comment)) to true
        out += SynSpan(0, end + 2, Syn.Comment)
        i = end + 2
    }
    while (i < n) {
        val c = line[i]
        when {
            blockComments(lang) && line.startsWith("/*", i) -> {
                val end = line.indexOf("*/", i + 2)
                if (end < 0) { out += SynSpan(i, n, Syn.Comment); return out to true }
                out += SynSpan(i, end + 2, Syn.Comment)
                i = end + 2
            }
            comment != null && line.startsWith(comment, i) && (comment != "#" || i == 0 || line[i - 1].isWhitespace()) -> {
                out += SynSpan(i, n, Syn.Comment)
                return out to false
            }
            c == '"' || c == '\'' || c == '`' -> {
                var j = i + 1
                while (j < n && line[j] != c) j += if (line[j] == '\\') 2 else 1
                val end = minOf(j + 1, n)
                val key = (lang == Lang.Json || lang == Lang.Yaml) && line.substring(end).trimStart().startsWith(":")
                out += SynSpan(i, end, if (key) Syn.Property else Syn.Str)
                i = end
            }
            c.isDigit() && (i == 0 || !line[i - 1].isLetterOrDigit() && line[i - 1] != '_') -> {
                var j = i + 1
                while (j < n && (line[j].isLetterOrDigit() || line[j] == '.' || line[j] == '_')) j++
                out += SynSpan(i, j, Syn.Num)
                i = j
            }
            c.isLetter() || c == '_' || c == '$' -> {
                var j = i + 1
                while (j < n && (line[j].isLetterOrDigit() || line[j] == '_' || line[j] == '$' || (lang == Lang.Yaml && line[j] == '-'))) j++
                val word = line.substring(i, j)
                val syn = when {
                    lang == Lang.Yaml && line.substring(j).startsWith(":") && line.substring(0, i).isBlank() -> Syn.Property
                    lang == Lang.Yaml && line.substring(j).startsWith(":") && line.substring(0, i).trim() == "-" -> Syn.Property
                    lang == Lang.Css && line.substring(j).trimStart().startsWith(":") && line.substring(0, i).isBlank() -> Syn.Property
                    word in keywords || (lang == Lang.Sql && word.lowercase() in SQL_KEYWORDS) -> Syn.Keyword
                    lang == Lang.CLike && word[0].isUpperCase() -> Syn.Type
                    else -> null
                }
                if (syn != null) out += SynSpan(i, j, syn)
                i = j
            }
            else -> i++
        }
    }
    return out to false
}

fun highlight(text: String, lang: Lang): List<List<SynSpan>> {
    var open = false
    return text.split('\n').map { line -> highlightLine(line, lang, open).also { open = it.second }.first }
}

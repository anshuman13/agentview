package no.pradhan.agentview.nativeapp.workspace

data class DocBlock(val start: Int, val raw: String)

private val FENCE = Regex("^\\s{0,3}(```|~~~)")

// The blocks of a Markdown file: runs of non-blank lines, a fenced code block kept whole. Each renders and edits on its own.
fun docBlocks(text: String): List<DocBlock> {
    val out = mutableListOf<DocBlock>()
    var start = -1
    var end = 0
    var fence: String? = null
    var at = 0
    while (at <= text.length) {
        val nl = text.indexOf('\n', at).let { if (it < 0) text.length else it }
        val line = text.substring(at, nl)
        val open = FENCE.find(line)?.groupValues?.get(1)
        if (fence == null && line.isBlank()) {
            if (start >= 0) out += DocBlock(start, text.substring(start, end))
            start = -1
        } else {
            if (start < 0) start = at
            end = nl
            if (fence == null && open != null) fence = open
            else if (fence != null && open == fence && line.trim() == fence) fence = null
        }
        if (nl >= text.length) break
        at = nl + 1
    }
    if (start >= 0) out += DocBlock(start, text.substring(start, end))
    return out
}

// shared/docEdit.ts replaceBlock: the edited block put back, keeping the blank lines after it; null when the file changed under it.
fun replaceBlock(text: String, block: DocBlock, value: String): String? {
    if (block.start + block.raw.length > text.length || text.substring(block.start, block.start + block.raw.length) != block.raw) return null
    val tail = Regex("\\s*$").find(block.raw)!!.value
    return text.substring(0, block.start) + value.trimEnd() + tail + text.substring(block.start + block.raw.length)
}

// shared/docEdit.ts docAskPrompt: the prompt Ask Claude sends about a passage of a Markdown file.
fun docAskPrompt(path: String, quote: String, ask: String): String {
    val quoted = quote.trim().split('\n').joinToString("\n") { "> $it" }
    return "In $path, about this part:\n\n$quoted\n\n${ask.trim()}\n\nEdit the file in place and leave the rest as it is."
}

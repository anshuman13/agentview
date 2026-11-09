package no.pradhan.agentview.nativeapp.codex.meetings


class Speaker(val name: String, val words: Int, val share: Double)

private val STAMP = Regex("""^\[?\(?\d{1,2}:\d{2}(:\d{2})?\)?]?$""")
private val NAME = Regex("""^\p{Lu}[\p{L}'.-]*(?: [\p{L}'.-]+){0,3}$""")
private val HEADING = Regex("""^\W*(transcript|transkripsjon)\W*$""", RegexOption.IGNORE_CASE)
private val LABEL = Regex("""^([^:]{1,40}):\s*(.*)$""")
private val BULLET = Regex("""^(?:#+|[-*•])\s+""")

private class Turn(val name: String, val rest: String)

private fun count(s: String) = s.split(Regex("\\s+")).count { it.isNotEmpty() }
private fun clean(s: String) = s.replace(BULLET, "").replace(Regex("[*_]"), "").trim()

private fun tally(lines: List<String>, label: (Int) -> Turn?): Map<String, Int> {
    val words = LinkedHashMap<String, Int>()
    var who: String? = null
    lines.forEachIndexed { i, line ->
        val l = label(i)
        if (l != null) who = l.name
        val n = count(l?.rest ?: line)
        if (who != null && n > 0) words[who!!] = (words[who!!] ?: 0) + n
    }
    return words
}

// web/src/codex/data/talkTime.ts: share of talk time by words spoken per speaker, most first.
fun talkTime(text: String): List<Speaker> {
    val all = text.split('\n').map(::clean)
    val start = all.indexOfLast { HEADING.matches(it) }
    val lines = all.drop(start + 1).filter { it.isNotEmpty() && !STAMP.matches(it) }
    val labels = lines.map { l -> LABEL.find(l)?.takeIf { NAME.matches(it.groupValues[1].trim()) }?.let { Turn(it.groupValues[1].trim(), it.groupValues[2]) } }
    val said = HashMap<String, Int>()
    labels.forEach { l -> if (l != null) said[l.name] = (said[l.name] ?: 0) + 1 }
    val colon = tally(lines) { i -> labels[i]?.takeIf { start >= 0 || said.getValue(it.name) > 1 } }
    val isName = { i: Int -> NAME.matches(lines[i]) && i + 1 < lines.size && !NAME.matches(lines[i + 1]) }
    val seen = HashMap<String, Int>()
    lines.indices.forEach { i -> if (isName(i)) seen[lines[i]] = (seen[lines[i]] ?: 0) + 1 }
    val block = tally(lines) { i -> if (isName(i) && seen.getValue(lines[i]) > 1) Turn(lines[i], "") else null }
    val words = if (colon.values.sum() >= block.values.sum()) colon else block
    val total = words.values.sum()
    return words.map { (name, n) -> Speaker(name, n, n.toDouble() / total) }.sortedByDescending { it.words }
}

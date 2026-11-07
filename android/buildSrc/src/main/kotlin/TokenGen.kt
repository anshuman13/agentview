package no.pradhan.agentview.tokens

import java.util.Locale

// Turns web/src/styles/tokens.css into Kotlin: colours per theme, then sizes, type and elevation.
// The app is touch only, so the (pointer: coarse) overrides apply.
object TokenGen {
    private val NATIVE_SIZES = listOf("buttonMd" to "34", "menuMin" to "200", "bar" to "3", "stroke" to "1.5")

    class Block(val selectors: List<String>, val media: String?, val decls: LinkedHashMap<String, String>)

    private val skip = listOf("safe-", "z-", "font", "mono", "pulse", "ease", "row-title", "row-meta", "type-", "radius-round")
    private val textUnits = listOf("fs-", "line-")
    private const val TOUCH = "(pointer: coarse)"

    // Tints the web mixes in feature CSS (features/github.css .gh-diff), added as tokens when their base is defined.
    private val derived = linkedMapOf(
        "diff-add-soft" to ("diff-add" to "color-mix(in srgb, var(--diff-add) 10%, transparent)"),
        "diff-del-soft" to ("diff-del" to "color-mix(in srgb, var(--diff-del) 10%, transparent)"),
    )

    fun parse(css: String): List<Block> = blocks(css.replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), ""), null)

    private fun blocks(css: String, media: String?): List<Block> {
        val out = ArrayList<Block>()
        var i = 0
        while (true) {
            val open = css.indexOf('{', i)
            if (open < 0) break
            val head = css.substring(i, open).trim()
            var depth = 1
            var j = open + 1
            while (j < css.length && depth > 0) { if (css[j] == '{') depth++ else if (css[j] == '}') depth--; j++ }
            val body = css.substring(open + 1, j - 1)
            if (head.startsWith("@media")) out += blocks(body, head.removePrefix("@media").trim())
            else if (!head.startsWith("@")) {
                val decls = LinkedHashMap<String, String>()
                for (d in body.split(';')) {
                    val k = d.substringBefore(':').trim()
                    if (k.startsWith("--")) decls[k.removePrefix("--")] = d.substringAfter(':').trim()
                }
                out += Block(head.split(',').map { it.trim() }, media, decls)
            }
            i = j
        }
        return out
    }

    // The custom properties in force for a theme, in cascade order: :root, the theme's own block, then touch overrides.
    fun vars(blocks: List<Block>, theme: String): LinkedHashMap<String, String> {
        val out = LinkedHashMap<String, String>()
        for (b in blocks) {
            if (b.media != null && b.media != TOUCH) continue
            if (b.selectors.any { it == ":root" || it == ":root[data-theme='$theme']" }) out.putAll(b.decls)
        }
        for ((k, v) in derived) if (v.first in out && k !in out) out[k] = v.second
        return out
    }

    fun resolve(value: String, vars: Map<String, String>, depth: Int = 0): String? {
        if (depth > 20) return null
        val m = Regex("var\\(--([\\w-]+)(?:,\\s*([^()]*))?\\)").find(value) ?: return value
        val sub = vars[m.groupValues[1]]?.let { resolve(it, vars, depth + 1) } ?: m.groupValues[2].ifEmpty { null } ?: return null
        return resolve(value.replaceRange(m.range, sub), vars, depth + 1)
    }

    // ARGB of a CSS colour, or null when it is not one this generator reads.
    fun color(v: String): Long? {
        val s = v.trim()
        if (s == "transparent") return 0L
        Regex("^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$").find(s)?.let { m ->
            val a = m.groupValues[2].ifEmpty { "ff" }.toLong(16)
            return (a shl 24) or m.groupValues[1].toLong(16)
        }
        Regex("^rgba?\\(([^)]*)\\)$").find(s)?.let { m ->
            val p = m.groupValues[1].split(',').map { it.trim() }
            if (p.size < 3) return null
            val a = p.getOrNull(3)?.toDoubleOrNull() ?: 1.0
            return argb(Math.round(a * 255).toInt(), p[0].toInt(), p[1].toInt(), p[2].toInt())
        }
        if (s.startsWith("color-mix(") && s.endsWith(")")) {
            val args = splitTop(s.removePrefix("color-mix(").removeSuffix(")"))
            if (args.size != 3 || args[0] != "in srgb") return null
            val (c1, p1) = stop(args[1]) ?: return null
            val (c2, p2) = stop(args[2]) ?: return null
            val w1 = p1 ?: (p2?.let { 1 - it } ?: 0.5)
            val w2 = p2 ?: (1 - w1)
            fun ch(c: Long, shift: Int) = ((c shr shift) and 0xff).toDouble()
            val a1 = ch(c1, 24) / 255 * w1
            val a2 = ch(c2, 24) / 255 * w2
            val a = a1 + a2
            if (a == 0.0) return 0L
            fun mix(shift: Int) = Math.round((ch(c1, shift) * a1 + ch(c2, shift) * a2) / a).toInt()
            return argb(Math.round(a * 255).toInt(), mix(16), mix(8), mix(0))
        }
        return null
    }

    private fun stop(arg: String): Pair<Long, Double?>? {
        val m = Regex("^(.*?)(?:\\s+([\\d.]+)%)?$").find(arg.trim()) ?: return null
        return (color(m.groupValues[1]) ?: return null) to m.groupValues[2].toDoubleOrNull()?.div(100)
    }

    private fun argb(a: Int, r: Int, g: Int, b: Int) = (a.toLong() shl 24) or (r.toLong() shl 16) or (g.toLong() shl 8) or b.toLong()

    private fun splitTop(s: String): List<String> {
        val out = ArrayList<String>()
        var depth = 0
        var start = 0
        s.forEachIndexed { i, c ->
            if (c == '(') depth++ else if (c == ')') depth-- else if (c == ',' && depth == 0) { out += s.substring(start, i).trim(); start = i + 1 }
        }
        out += s.substring(start).trim()
        return out
    }

    fun camel(name: String): String {
        val parts = name.split('-').filter { it.isNotEmpty() }
        return parts.first() + parts.drop(1).joinToString("") { it.replaceFirstChar(Char::uppercaseChar) }
    }

    private fun num(d: Double): String = if (d == Math.floor(d)) d.toLong().toString() else String.format(Locale.US, "%s", d.toBigDecimal().stripTrailingZeros().toPlainString())

    private fun hex(c: Long) = "0x" + String.format(Locale.US, "%08X", c)

    // One Kotlin line per scale token, or null for tokens that are not a size, number or elevation.
    fun scale(name: String, value: String): String? {
        if (skip.any { name.startsWith(it) }) return null
        val id = camel(name)
        Regex("^(-?[\\d.]+)px$").find(value)?.let { m ->
            val unit = if (textUnits.any { name.startsWith(it) }) "sp" else "dp"
            return "val $id = ${num(m.groupValues[1].toDouble())}.$unit"
        }
        Regex("^([\\d.]+)px solid\\b").find(value)?.let { return "val $id = ${num(it.groupValues[1].toDouble())}.dp" }
        Regex("^0 ([\\d.]+)px ([\\d.]+)px ").find(value)?.let { return "val $id = ${num(it.groupValues[2].toDouble() / 2)}.dp" }
        Regex("^(-?[\\d.]+)em$").find(value)?.let { return "val $id = ${num(it.groupValues[1].toDouble())}f" }
        Regex("^(\\d+)ms$").find(value)?.let { return "const val $id = ${it.groupValues[1]}" }
        Regex("^([\\d.]+)%$").find(value)?.let { return "val $id = ${num(it.groupValues[1].toDouble() / 100)}f" }
        Regex("^([\\d.]+)$").find(value)?.let { if (name.startsWith("lh")) return "val $id = ${num(it.groupValues[1].toDouble())}f" }
        return null
    }

    private val roles = listOf("large-title", "title", "headline", "body", "callout", "subheadline", "footnote", "caption", "meta", "display", "label")

    fun generate(css: String, pkg: String): String {
        val blocks = parse(css)
        val dark = vars(blocks, "dark")
        val light = vars(blocks, "light")
        val colors = dark.keys.mapNotNull { k ->
            val d = resolve(dark.getValue(k), dark)?.let(::color) ?: return@mapNotNull null
            val l = light[k]?.let { resolve(it, light) }?.let(::color) ?: return@mapNotNull null
            Triple(camel(k), d, l)
        }
        val colorNames = colors.map { it.first }.toSet()
        val scales = dark.keys.filter { camel(it) !in colorNames }.mapNotNull { k -> resolve(dark.getValue(k), dark)?.let { scale(k, it) } }
        val types = roles.mapNotNull { r ->
            val size = resolve("var(--type-$r-size)", dark)?.removeSuffix("px")?.toDoubleOrNull() ?: return@mapNotNull null
            val line = resolve("var(--type-$r-line)", dark)?.toDoubleOrNull() ?: 1.0
            val weight = resolve("var(--type-$r-weight)", dark)?.toIntOrNull() ?: 400
            "val ${camel(r)} = TextStyle(fontSize = ${num(size)}.sp, lineHeight = ${num(Math.round(size * line * 10) / 10.0)}.sp, fontWeight = FontWeight($weight))"
        }
        return buildString {
            appendLine("// Generated by ./gradlew generateTokens from agentview/web/src/styles/tokens.css. Do not edit.")
            appendLine("package $pkg")
            appendLine()
            appendLine("import androidx.compose.runtime.Immutable")
            appendLine("import androidx.compose.ui.graphics.Color")
            appendLine("import androidx.compose.ui.text.TextStyle")
            appendLine("import androidx.compose.ui.text.font.FontWeight")
            appendLine("import androidx.compose.ui.unit.dp")
            appendLine("import androidx.compose.ui.unit.sp")
            appendLine()
            appendLine("@Immutable")
            appendLine("class AvColors(")
            colors.forEach { appendLine("    val ${it.first}: Color,") }
            appendLine(")")
            for ((label, pick) in listOf<Pair<String, (Triple<String, Long, Long>) -> Long>>("DarkColors" to { it.second }, "LightColors" to { it.third })) {
                appendLine()
                appendLine("val $label = AvColors(")
                colors.forEach { appendLine("    ${it.first} = Color(${hex(pick(it))}),") }
                appendLine(")")
            }
            appendLine()
            appendLine("object Tokens {")
            scales.forEach { appendLine("    $it") }
            appendLine("    // Sizes the web keeps in component CSS, not in tokens.css.")
            NATIVE_SIZES.forEach { (name, dp) -> appendLine("    val $name = ${dp}.dp") }
            appendLine("}")
            appendLine()
            appendLine("object Type {")
            types.forEach { appendLine("    $it") }
            appendLine("}")
        }
    }
}

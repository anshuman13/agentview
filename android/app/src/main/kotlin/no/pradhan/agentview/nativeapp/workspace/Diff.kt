package no.pradhan.agentview.nativeapp.workspace


// A line of web/src/chat/Pending.tsx lineDiff: ' ' kept, '-' removed, '+' added.
data class DiffLine(val mark: Char, val text: String)

const val MAX_DIFF_LINES = 200

fun lineDiff(a: String, b: String): List<DiffLine> {
    val x = if (a.isEmpty()) emptyList() else a.split('\n')
    val y = if (b.isEmpty()) emptyList() else b.split('\n')
    val n = x.size
    val m = y.size
    if (n.toLong() * m > 250_000) return x.map { DiffLine('-', it) } + y.map { DiffLine('+', it) }
    val l = Array(n + 1) { IntArray(m + 1) }
    for (i in n - 1 downTo 0) for (j in m - 1 downTo 0) l[i][j] = if (x[i] == y[j]) l[i + 1][j + 1] + 1 else maxOf(l[i + 1][j], l[i][j + 1])
    val out = mutableListOf<DiffLine>()
    var i = 0
    var j = 0
    while (i < n || j < m) {
        when {
            i < n && j < m && x[i] == y[j] -> { out += DiffLine(' ', x[i]); i++; j++ }
            i < n && (j == m || l[i + 1][j] >= l[i][j + 1]) -> out += DiffLine('-', x[i++])
            else -> out += DiffLine('+', y[j++])
        }
    }
    return out
}

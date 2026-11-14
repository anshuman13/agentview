package no.pradhan.agentview.nativeapp.ui

// Text helpers every feature uses.
fun plural(n: Int, word: String, many: String = word + "s") = "$n ${if (n == 1) word else many}"

fun isoMillis(iso: String): Long = runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)

// web/src/ui/util.tsx ago: "now", "5m", "3h", "2d", "1w".
fun agoShort(t: Long, now: Long, suffix: String = ""): String {
    if (t <= 0) return ""
    val m = maxOf(0L, (now - t) / 60_000)
    if (m < 1) return "now"
    val text = when {
        m < 60 -> "${m}m"
        m < 1440 -> "${Math.round(m / 60.0)}h"
        m < 10080 -> "${Math.round(m / 1440.0)}d"
        else -> "${Math.round(m / 10080.0)}w"
    }
    return text + suffix
}

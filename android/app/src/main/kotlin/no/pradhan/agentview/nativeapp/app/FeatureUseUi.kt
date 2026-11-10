package no.pradhan.agentview.nativeapp.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import java.time.LocalDate
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens

private const val SHOWN = 5

private fun kindLabel(f: Feature) = f.kind.replaceFirstChar { it.uppercase() }

@Composable
private fun <T> FeatureSection(label: String, rows: List<T>, title: (T) -> String, meta: (T) -> String) {
    var all by remember { mutableStateOf(false) }
    SectionHeader(label, rows.size.toString())
    Group {
        (if (all) rows else rows.take(SHOWN)).forEachIndexed { i, r ->
            if (i > 0) Hairline()
            ListRow(title(r), meta(r))
        }
        if (!all && rows.size > SHOWN) { Hairline(); ListRow("Show all ${rows.size}", onClick = { all = true }) }
    }
}

// Every feature the Mac has counted (web FeatureUseSheet), split into never used and used, for the last 7 or 30 days.
@Composable
fun FeatureUseSheet(hub: Hub, onDismiss: () -> Unit) {
    var days by remember { mutableStateOf<Map<String, Map<String, Int>>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var span by remember { mutableStateOf(30) }
    LaunchedEffect(Unit) {
        runCatching { hub.api.featureUse() }.onSuccess { days = it }.onFailure { error = it.message ?: "Unknown error" }
    }
    val today = LocalDate.now().toString()
    Sheet(onDismiss, "Feature use") {
        Row(Modifier.padding(Tokens.sp6), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            listOf(7, 30).forEach { n -> Chip("$n days", { span = n }, on = span == n) }
        }
        error?.let { EmptyState("Could not load feature use", it) }
        days?.let { d ->
            val rows = featureRows(d, today, span)
            FeatureSection("Never used", rows.never, { it.label }, { kindLabel(it) })
            FeatureSection("Used", rows.used, { it.feature.label }, {
                val n = if (span == 7) it.n7 else it.n30
                "${kindLabel(it.feature)} · $n ${if (n == 1) "time" else "times"} · ${lastUsed(it.last, today)}"
            })
        }
    }
}

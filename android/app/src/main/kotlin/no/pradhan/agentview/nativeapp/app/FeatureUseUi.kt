package no.pradhan.agentview.nativeapp.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import java.time.LocalDate
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.setHiddenFeatures
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens

private const val SHOWN = 5

private fun kindLabel(f: Feature) = f.kind.replaceFirstChar { it.uppercase() }

@Composable
private fun <T> FeatureSection(label: String, rows: List<T>, title: (T) -> String, meta: (T) -> String, menu: (T) -> (@Composable ColumnScope.(() -> Unit) -> Unit)?) {
    var all by remember { mutableStateOf(false) }
    SectionHeader(label, rows.size.toString())
    Group {
        (if (all) rows else rows.take(SHOWN)).forEachIndexed { i, r ->
            if (i > 0) Hairline()
            ListRow(title(r), meta(r), menu = menu(r))
        }
    }
    if (!all && rows.size > SHOWN) Button("Show all ${rows.size}", { all = true }, Modifier.padding(start = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
}

// Every feature the Mac has counted (web FeatureUseSheet), split into never used and used, for the last 7 or 30 days; hidden features are listed apart.
@Composable
fun FeatureUseSheet(hub: Hub, onDismiss: () -> Unit) {
    var days by remember { mutableStateOf<Map<String, Map<String, Int>>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var span by remember { mutableStateOf(30) }
    val on by hub.featureUse.collectAsState()
    val hidden by hub.hiddenFeatures.collectAsState()
    LaunchedEffect(Unit) {
        runCatching { hub.api.featureUse() }.onSuccess { days = it }.onFailure { error = it.message ?: "Unknown error" }
    }
    val today = LocalDate.now().toString()
    Sheet(onDismiss, "Feature use") {
        if (on) Row(Modifier.padding(Tokens.sp6), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            listOf(7, 30).forEach { n -> Chip("$n days", { span = n }, on = span == n) }
        }
        error?.let { EmptyState("Could not load feature use", it) }
        days?.let { d ->
            val rows = remember(d, span) { featureRows(d, today, span) }
            val usedMeta = { u: UsedFeature ->
                val n = if (span == 7) u.n7 else u.n30
                "${kindLabel(u.feature)} · $n ${if (n == 1) "time" else "times"} · ${lastUsed(u.last, today)}"
            }
            val menu = { f: Feature ->
                if (!f.hideable) null else {
                    val isHidden = f.id in hidden
                    val content: @Composable ColumnScope.(() -> Unit) -> Unit = { close ->
                        if (isHidden) MenuItem("Show", "eye", { close(); hub.setHiddenFeatures(hidden - f.id, "${f.label} shown", hidden) }, enabled = !hub.readOnly)
                        else MenuItem("Hide", "eye-closed", { close(); hub.setHiddenFeatures(hidden + f.id, "${f.label} hidden", hidden) }, enabled = !hub.readOnly)
                    }
                    content
                }
            }
            if (on) {
                FeatureSection("Never used", rows.never.filter { it.id !in hidden }, { it.label }, { kindLabel(it) }, menu)
                FeatureSection("Used", rows.used.filter { it.feature.id !in hidden }, { it.feature.label }, usedMeta) { menu(it.feature) }
            }
            val hiddenRows = (rows.used.map { it.feature } + rows.never).filter { it.id in hidden }
            if (hiddenRows.isNotEmpty()) FeatureSection("Hidden", hiddenRows, { it.label }, { f -> rows.used.find { it.feature.id == f.id }?.let(usedMeta) ?: kindLabel(f) }, menu)
        }
    }
}

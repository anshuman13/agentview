package no.pradhan.agentview.nativeapp.ops

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.usage
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.rememberLoad
import no.pradhan.agentview.nativeapp.workspace.ErrorHint
import no.pradhan.agentview.nativeapp.workspace.PageBody

// Usage (web/src/ops/Usage.tsx): one card per Claude account with its limits, a 7-day line chart and 30-day token bars.
@Composable
fun UsageScreen(hub: Hub, onBack: () -> Unit) {
    val (load, reload) = rememberLoad("usage") { hub.usage(30) }
    val now = remember(load.data) { System.currentTimeMillis() }
    val accounts = load.data?.accounts ?: emptyList()
    Column(Modifier.fillMaxSize()) {
        PageHeader("Usage", onBack) { IconBtn("refresh", "Refresh", reload) }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                item { ErrorHint(load.error) }
                if (load.data == null) { if (load.error.isEmpty()) item { Loading("Loading usage…") } }
                else if (accounts.isEmpty()) item { EmptyState("No Claude accounts are logged in", icon = "graph", small = false) }
                items(accounts, key = { it.account }) { a ->
                    SectionHeader(a.name)
                    Group { Column(Modifier.padding(Tokens.listPad), verticalArrangement = Arrangement.spacedBy(Tokens.sp8)) { UsageCard(a, now) } }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
}

private data class UsageColors(val five: Color, val week: Color, val kinds: List<Color>)

@Composable
private fun usageColors() = av.let { UsageColors(it.hueBlue, it.hueViolet, listOf(it.hueBlue, it.hueGreen, it.hueAmber, it.hueTeal)) }

@Composable
private fun UsageCard(a: UsageAccount, now: Long) {
    val colors = usageColors()
    Limits(limitRows(a.latest, now))
    Lines(seriesLines(a.series, now), colors)
    Bars(a.days, colors)
}

@Composable
private fun Limits(rows: List<LimitRow>) {
    if (rows.isEmpty()) { Text("No limits sampled yet", style = Type.footnote, color = av.fgMuted); return }
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        for (r in rows) Column {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Text(r.label, style = Type.subheadline, color = av.fg)
                Meter(r.pct, Modifier.weight(1f))
                Text("${r.pct}%", Modifier.width(Tokens.size2xl * 1.5f), style = Type.subheadline, color = av.fg, textAlign = TextAlign.End)
            }
            if (r.text.isNotEmpty()) Text(r.text, style = Type.caption, color = av.fgMuted)
        }
    }
}

@Composable
private fun Meter(pct: Int, modifier: Modifier) {
    val fill = if (pct >= 90) av.warn else av.accentFill
    Box(modifier.height(Tokens.sp3).clip(RoundedCornerShape(Tokens.radiusPill)).background(av.sunken).semantics { contentDescription = "$pct%" }) {
        Box(Modifier.fillMaxWidth(pct.coerceIn(0, 100) / 100f).height(Tokens.sp3).clip(RoundedCornerShape(Tokens.radiusPill)).background(fill))
    }
}

@Composable
private fun Key(label: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        Box(Modifier.size(Tokens.sp6, Tokens.sp1).clip(RoundedCornerShape(Tokens.radiusPill)).background(color))
        Text(label, style = Type.caption, color = av.fgMuted)
    }
}

@Composable
private fun Lines(lines: UsageLines, colors: UsageColors) {
    if (lines.fiveHour.isEmpty() && lines.week.isEmpty()) return
    val grid = av.border
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Text("Last 7 days", Modifier.weight(1f), style = Type.caption, color = av.fgMuted)
            Key("5-hour", colors.five)
            Key("Weekly", colors.week)
        }
        Canvas(Modifier.fillMaxWidth().height(Tokens.rowThree).clip(RoundedCornerShape(Tokens.radiusSm)).background(av.sunken).semantics { contentDescription = "5-hour and weekly use over the last 7 days" }) {
            val stroke = Tokens.stroke.toPx()
            for (y in listOf(0.25f, 0.5f, 0.75f)) drawLine(grid, Offset(0f, size.height * y), Offset(size.width, size.height * y), 1f)
            fun line(pts: List<UsagePt>, color: Color) {
                if (pts.isEmpty()) return
                val path = Path()
                pts.forEachIndexed { i, p ->
                    val o = Offset((p.x * size.width).toFloat(), ((1 - minOf(100.0, p.y) / 100) * size.height).toFloat())
                    if (i == 0) path.moveTo(o.x, o.y) else path.lineTo(o.x, o.y)
                }
                drawPath(path, color, style = Stroke(stroke, join = StrokeJoin.Round))
            }
            line(lines.fiveHour, colors.five)
            line(lines.week, colors.week)
        }
    }
}

@Composable
private fun Bars(days: List<UsageDay>, colors: UsageColors) {
    val bars = remember(days) { dayBars(days) }
    val totals = remember(days) { tokenTotals(days) }
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
        Text("Tokens per day, last ${days.size} days", style = Type.caption, color = av.fgMuted)
        Canvas(Modifier.fillMaxWidth().height(Tokens.spark).clip(RoundedCornerShape(Tokens.radiusSm)).background(av.sunken).semantics { contentDescription = "Tokens per day" }) {
            val w = size.width / maxOf(1, bars.size)
            bars.forEachIndexed { i, b ->
                var y = size.height
                b.parts.forEachIndexed { k, p ->
                    val h = (p * size.height).toFloat()
                    y -= h
                    if (h > 0) drawRect(colors.kinds[k], Offset(i * w + w * 0.15f, y), Size(w * 0.7f, h))
                }
            }
        }
        Row {
            Text(bars.firstOrNull()?.label.orEmpty(), Modifier.weight(1f), style = Type.caption, color = av.fgMuted)
            Text(bars.lastOrNull()?.label.orEmpty(), style = Type.caption, color = av.fgMuted)
        }
        TOKEN_KINDS.forEachIndexed { k, kind ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
                Box(Modifier.size(Tokens.sp5).clip(RoundedCornerShape(Tokens.radiusXs)).background(colors.kinds[k]))
                Text(TOKEN_LABEL[kind].orEmpty(), Modifier.weight(1f), style = Type.footnote, color = av.fg)
                Text(tokens(totals[kind] ?: 0), style = Type.footnote, color = av.fgMuted)
            }
        }
    }
}

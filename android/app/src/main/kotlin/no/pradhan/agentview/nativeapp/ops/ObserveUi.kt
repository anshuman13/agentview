package no.pradhan.agentview.nativeapp.ops

import androidx.compose.foundation.Canvas
import kotlinx.serialization.json.JsonNull
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.net.refreshWorkspace
import no.pradhan.agentview.nativeapp.net.write
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.ErrorHint
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.WorkspaceHeader
import no.pradhan.agentview.nativeapp.workspace.openLink
import no.pradhan.agentview.nativeapp.workspace.rememberLoad

// Observe (web/src/ops/Observe.tsx): Grafana dashboards, metric panels, error logs and patterns of a repo, and its settings.
@Composable
fun ObserveScreen(hub: Hub, onBack: () -> Unit) {
    val st by hub.store.state.collectAsState()
    val ws by hub.workspace.collectAsState()
    val chat = st.shownId
    var picked by rememberSaveable(chat) { mutableStateOf("") }
    var picking by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }
    val (load, reload) = rememberLoad(chat, picked) { parseObserve(hub.read("/api/observe" + if (picked.isNotEmpty()) "?repo=${enc(picked)}" else "")) }
    val info = load.data
    LaunchedEffect(Unit) { hub.refreshWorkspace() }

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Observe", onBack, sub = info?.repo ?: picked.ifEmpty { null }) {
            IconBtn("refresh", "Refresh", { reload(); tick++ })
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Group(Modifier.padding(top = Tokens.sp4)) {
                        ListRow("Project", info?.repo ?: picked.ifEmpty { "This chat's repo" }, onClick = { picking = true }, trailing = { if (picked.isNotEmpty()) Button("This chat", { picked = "" }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })
                    }
                }
                item { ErrorHint(load.error) }
                if (info == null) { if (load.error.isEmpty()) item { Loading("Loading…") } }
                else {
                    if (info.config == null || info.config is JsonNull) item {
                        if (info.local) EmptyState("No Grafana settings for ${info.repo}", "It has no deploy app, so it runs only on this Mac", icon = "pulse")
                        else EmptyState("No Grafana settings for ${info.repo}", "The agent can find them and save the settings", action = { SetupButton(hub, "observe", info.repo) }, icon = "pulse")
                    }
                    item(key = "grafana:${info.repo}:$tick") { Grafana(hub, info) }
                    item { Snowflake(info.snowflake) }
                    item(key = "settings:${info.repo}") { ObserveSettings(hub, info) { reload() } }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
    if (picking) Sheet(onDismiss = { picking = false }, title = "Project", padded = false) {
        Group {
            observeRepos(ws.repos.map { it.name }, info).forEachIndexed { i, n ->
                if (i > 0) Hairline()
                ListRow(n, selected = n == info?.repo, onClick = { picking = false; picked = n })
            }
        }
    }
}

@Composable
private fun Snowflake(sf: SnowflakeInfo) {
    var open by rememberSaveable { mutableStateOf(true) }
    Column {
        SectionHeader("Snowflake", open = open, onToggle = { open = !open })
        if (!open) return@Column
        val connected = sf.hasSecret && sf.account.isNotEmpty() && sf.user.isNotEmpty()
        Group { ListRow(if (connected) "${sf.user} on ${sf.account}" else "Not connected", if (connected) "Connected" else "Off") }
    }
}

@Composable
private fun Grafana(hub: Hub, info: ObserveInfo) {
    var open by rememberSaveable { mutableStateOf(true) }
    val link = openLink()
    val repo = enc(info.repo)
    Column {
        SectionHeader("Grafana", open = open, onToggle = { open = !open })
        if (!open) return@Column
        if (!info.grafanaServer) { EmptyState("No Grafana server", "Add the Grafana MCP server"); return@Column }
        val (dash) = rememberLoad(info.repo, "dash") { protocolJson.decodeFromString(GrafanaDashboards.serializer(), hub.read("/api/observe/grafana/dashboards?repo=$repo")) }
        val (panels) = rememberLoad(info.repo, "panels") { protocolJson.decodeFromString(GrafanaPanels.serializer(), hub.read("/api/observe/grafana/panels?repo=$repo")) }
        val (logs) = rememberLoad(info.repo, "logs") { protocolJson.decodeFromString(GrafanaLogs.serializer(), hub.read("/api/observe/grafana/logs?repo=$repo")) }
        val (pats) = rememberLoad(info.repo, "patterns") { protocolJson.decodeFromString(GrafanaPatterns.serializer(), hub.read("/api/observe/grafana/patterns?repo=$repo")) }

        val boards = dash.data?.dashboards ?: emptyList()
        SectionHeader(if (dash.busy) "Looking for dashboards…" else plural(boards.size, "dashboard"), action = linkAction("Search", dash.data?.link, link))
        ErrorHint(dash.error)
        if (boards.isNotEmpty()) Group {
            boards.forEachIndexed { i, d ->
                if (i > 0) Hairline()
                ListRow(d.title, d.folder, lines = 1, onClick = if (d.url.isNotEmpty()) ({ link(d.url) }) else null)
            }
        } else if (dash.data != null) EmptyState("No dashboards match", "Set grafana.query or grafana.dashboards in the settings")

        SectionHeader("Metrics, last 6 hours")
        if (panels.busy && panels.data == null) Loading("Loading…")
        ErrorHint(panels.error)
        panels.data?.let { p ->
            Group {
                if (p.panels.isEmpty()) EmptyState("No metric panels", "Add grafana.panels in the settings")
                p.panels.forEachIndexed { i, panel ->
                    if (i > 0) Hairline()
                    PanelRow(panel) { panel.link?.let(link) }
                }
            }
        }

        SectionHeader("Error logs, last hour", action = linkAction("Open", logs.data?.link, link))
        if (logs.busy && logs.data == null) Loading("Loading…")
        ErrorHint(logs.error)
        logs.data?.let { l ->
            Group {
                if (l.logs.isEmpty()) EmptyState("No error lines", "${l.scanned} lines scanned in the last hour")
                Column(Modifier.padding(vertical = Tokens.sp3)) {
                    l.logs.forEach { line -> LogRow(line) }
                }
            }
        }

        SectionHeader("Error patterns", action = linkAction("Open", pats.data?.link, link))
        if (pats.busy && pats.data == null) Loading("Loading…")
        ErrorHint(pats.error)
        pats.data?.let { p ->
            Group {
                if (p.patterns.isEmpty()) EmptyState("No error patterns")
                p.patterns.forEachIndexed { i, pat ->
                    if (i > 0) Hairline(lead = true)
                    ListRow(pat.pattern, lines = 3, leading = { Text("${pat.count}", style = Type.label, color = av.err) })
                }
            }
        }
    }
}

private fun linkAction(label: String, url: String?, link: (String) -> Unit): (@Composable androidx.compose.foundation.layout.RowScope.() -> Unit)? =
    if (url == null) null else ({ Button(label, { link(url) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) })

@Composable
private fun PanelRow(p: GrafanaPanel, onClick: () -> Unit) {
    val meta = p.last?.let { AnnotatedString(panelNum(it) + (p.unit ?: "")) } ?: buildAnnotatedString { withStyle(SpanStyle(color = av.err)) { append(p.error ?: "No data") } }
    ListRow(
        p.title, meta, lines = 1,
        trailing = { if (p.points.size > 1) Sparkline(p.points) },
        onClick = if (p.link != null) onClick else null,
    )
}

@Composable
private fun Sparkline(points: List<List<Double>>) {
    val ys = remember(points) { sparkline(points) }
    val color = av.fgMuted
    Canvas(Modifier.size(Tokens.spark, Tokens.sizeXl)) {
        if (ys.size < 2) return@Canvas
        val stroke = Tokens.stroke.toPx()
        val path = Path()
        ys.forEachIndexed { i, y ->
            val o = Offset(i * size.width / (ys.size - 1), stroke + (1 - y) * (size.height - 2 * stroke))
            if (i == 0) path.moveTo(o.x, o.y) else path.lineTo(o.x, o.y)
        }
        drawPath(path, color, style = Stroke(stroke))
    }
}

@Composable
private fun LogRow(l: LogLine) {
    val c = av
    val color = when (l.level) { "error", "critical", "fatal" -> c.err; "warn", "warning" -> c.warn; else -> c.fg }
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = c.fgMuted)) { append(logClock(l.ts) + "  ") }
            withStyle(SpanStyle(color = color)) { append(l.line) }
        },
        Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), style = Mono, maxLines = 2, overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun ObserveSettings(hub: Hub, info: ObserveInfo, onSaved: () -> Unit) {
    var open by rememberSaveable(info.repo) { mutableStateOf(false) }
    var draft by rememberSaveable(info.repo) { mutableStateOf(observeDraft(info)) }
    var state by rememberSaveable(info.repo) { mutableStateOf("") }
    var error by remember(info.repo) { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    Column {
        SectionHeader("Settings", open = open, onToggle = { open = !open }, action = when (state) {
            "unsaved" -> ({ Badge("Unsaved", BadgeTone.Waiting) })
            "saved" -> ({ Badge("Saved", BadgeTone.Done) })
            "failed" -> ({ Badge("Failed", BadgeTone.Failed) })
            else -> null
        })
        if (!open) return@Column
        Column(Modifier.padding(horizontal = Tokens.listPad), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            TextField(draft, { draft = it; state = "unsaved"; error = "" }, minLines = 8, style = Mono)
            if (error.isNotEmpty()) Text(error, style = Type.subheadline, color = av.err)
            Text("Grafana MCP: ${if (info.grafanaServer) "found in" else "missing from"} ${info.serversFile}", style = Type.footnote, color = av.fgMuted)
            Row { Button("Save", {
                val body = runCatching { observeConfigBody(info.repo, draft) }.getOrElse { error = it.message ?: "Invalid JSON"; state = "failed"; return@Button }
                saving = true
                hub.write("/api/observe/config", body, "Could not save the settings") { ok -> saving = false; state = if (ok) "saved" else "failed"; if (ok) onSaved() }
            }, variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = !saving) }
        }
    }
}

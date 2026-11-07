package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay

private data class DeployAsk(val title: String, val detail: String, val action: String, val run: (String) -> Unit, val input: String? = null)

// Deploy (web/src/ops/Deploy.tsx): the Velo app's environments, what runs where, deploy and roll back with a confirm.
@Composable
fun DeployScreen(hub: Hub, onBack: () -> Unit) {
    val st by hub.store.state.collectAsState()
    val chat = st.shownId
    var app by rememberSaveable(chat) { mutableStateOf("") }
    val (load, reload) = rememberLoad(chat, app) { parseDeploy(hub.read("/api/deploy/status" + if (app.isNotEmpty()) "?app=${enc(app)}" else "")) }
    LaunchedEffect(chat, app) { while (true) { delay(60_000); reload() } }
    var job by remember(chat) { mutableStateOf<DeployJob?>(null) }
    var ask by remember { mutableStateOf<DeployAsk?>(null) }
    val link = openLink()
    val s = load.data
    val now = System.currentTimeMillis()

    LaunchedEffect(job?.id, job?.done) {
        val j = job ?: return@LaunchedEffect
        if (j.done || j.id.isEmpty()) { reload(); return@LaunchedEffect }
        delay(3000)
        job = runCatching { parseDeployJob(hub.read("/api/deploy/job/${j.id}")) }.getOrElse { j.copy(lines = j.lines + (it.message ?: "Lost the deploy"), done = true) }
    }

    fun begin(path: String, body: String) = hub.writes.run("Could not start the deploy", { job = parseDeployJob(hub.api.post(path, body, hub.pageChat)) })

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Deploy", onBack, sub = s?.app) {
            if (s != null && s.apps.size > 1) MoreButton("Switch app") { close -> s.apps.forEach { a -> MenuItem(a, { close(); app = a }, checked = a == s.app) } }
            IconBtn(Icons.Filled.Refresh, "Refresh", reload)
        }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                if (load.error.contains("no Velo app")) item { EmptyState("No Velo app here", "This repo has no .deploy/app.yaml") }
                else item { ErrorHint(load.error) }
                if (s == null && load.error.isEmpty()) item { Hint("Loading") }
                if (s != null) {
                    item { SectionHeader(s.app.ifEmpty { "Velo" }) }
                    item {
                        Group {
                            s.envs.forEachIndexed { i, env ->
                                if (i > 0) Hairline()
                                val warn = deployWarning(env)
                                fun deploy(ref: String?) {
                                    ask = DeployAsk(
                                        "Deploy to ${env.label}?",
                                        (if (ref != null) "Deploys ${shortSha(ref)} (HEAD of ${s.head.branch}) of ${s.app} to ${env.label} through Velodrome." else "Branch or commit of ${s.app} to deploy to ${env.label} through Velodrome.") + (warn?.let { " $it" } ?: ""),
                                        "Deploy", { v -> begin("/api/deploy/run", deployBody(s.app, env.name, ref ?: v)) }, if (ref == null) s.head.branch else null,
                                    )
                                }
                                ListRow(env.label, envMeta(env, s, now), trailing = {
                                    envBadge(env)?.let { (t, tone) -> Badge(t, tone) }
                                    Button("Deploy", { deploy(s.head.sha) }, size = ButtonSize.Sm)
                                    MoreButton { close ->
                                        MenuItem("Deploy a branch or commit...", { close(); deploy(null) })
                                        env.deployed?.let { d -> MenuItem("Open ${shortSha(d.sha)} on GitHub", { close(); link("https://github.com/${s.repo}/commit/${d.sha}") }) }
                                        MenuItem("Roll back", {
                                            close()
                                            val to = env.rollbackTo
                                            val d = env.deployed
                                            if (to != null && d != null) ask = DeployAsk(
                                                "Roll back ${env.label}?",
                                                "Redeploys ${shortSha(to.sha)} (deployed ${agoShort(isoMillis(to.at), now, " ago")}) in place of ${shortSha(d.sha)}." + (warn?.let { " $it" } ?: ""),
                                                "Roll back", { begin("/api/deploy/rollback", rollbackBody(s.app, env.name, to.sha)) },
                                            )
                                        }, enabled = env.rollbackTo != null && env.deployed != null)
                                    }
                                })
                            }
                        }
                    }
                    if (s.velodrome.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp6)) { ListRow("Open in Velodrome", onClick = { link(s.velodrome) }) } }
                }
                job?.let { j ->
                    item {
                        SectionHeader(
                            if (!j.done) "Deploying" else if (j.ok) "Deployed" else "Deploy did not succeed",
                            color = if (!j.done) av.accentText else if (j.ok) av.ok else av.err,
                            action = if (j.done) ({ Button("Close", { job = null }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) else null,
                        )
                    }
                    item {
                        Group {
                            Text(j.lines.joinToString("\n"), Modifier.horizontalScroll(rememberScrollState()).padding(Tokens.sp6), style = Mono, color = av.fg, softWrap = false)
                            if (j.url.isNotEmpty()) ListRow("Open in Velodrome", onClick = { link(j.url) })
                        }
                    }
                }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
    ask?.let { a ->
        if (a.input != null) TextDialog(a.title, a.input, a.action, { v -> if (v.isNotBlank()) a.run(v.trim()) }, onDismiss = { ask = null })
        else ConfirmDialog(a.title, a.detail, a.action, { a.run("") }, danger = true, onDismiss = { ask = null })
    }
}

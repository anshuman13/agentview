package no.pradhan.agentview.nativeapp.ops

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.delay
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.deployJob
import no.pradhan.agentview.nativeapp.net.deployStatus
import no.pradhan.agentview.nativeapp.net.rollbackDeploy
import no.pradhan.agentview.nativeapp.net.runDeploy
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.Mono
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextDialog
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.WhileStarted
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.ErrorHint
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.WorkspaceHeader
import no.pradhan.agentview.nativeapp.workspace.agoShort
import no.pradhan.agentview.nativeapp.workspace.isoMillis
import no.pradhan.agentview.nativeapp.workspace.openLink
import no.pradhan.agentview.nativeapp.workspace.rememberLoad
import no.pradhan.agentview.nativeapp.ui.select

private data class DeployAsk(val title: String, val detail: String, val action: String, val run: (String) -> Unit, val input: String? = null)

@Composable
private fun envMetaLine(env: DeployEnv, s: DeployStatus, now: Long): AnnotatedString {
    val badge = envBadge(env)
    val color = when (badge?.second) { BadgeTone.Done -> av.ok; BadgeTone.Failed -> av.err; else -> av.agent }
    return buildAnnotatedString {
        if (badge != null) { withStyle(SpanStyle(color = color)) { append(badge.first) }; append(" · ") }
        append(envMeta(env, s, now))
    }
}
// Polls a running deploy job until it finishes, then reloads the status.
@Composable
private fun PollDeployJob(hub: Hub, job: MutableState<DeployJob?>, reload: () -> Unit) {
    LaunchedEffect(job.value?.id) {
        var j = job.value ?: return@LaunchedEffect
        while (!j.done && j.id.isNotEmpty()) {
            delay(3000)
            val was = j
            j = runCatching { hub.deployJob(was.id) }.getOrElse { was.copy(lines = was.lines + (it.message ?: "Lost the deploy"), done = true) }
            job.value = j
        }
        reload()
    }
}

// Deploy (web/src/ops/Deploy.tsx): the deploy app's environments, what runs where, deploy and roll back with a confirm.
@Composable
fun DeployScreen(hub: Hub, onBack: () -> Unit) {
    val shownId by hub.store.state.select { it.shownId }
    val chat = shownId
    var app by rememberSaveable(chat) { mutableStateOf("") }
    val (load, reload) = rememberLoad(chat, app) { hub.deployStatus(app) }
    WhileStarted(chat, app) { while (true) { delay(60_000); reload() } }
    val job = remember(chat) { mutableStateOf<DeployJob?>(null) }
    var ask by remember { mutableStateOf<DeployAsk?>(null) }
    val link = openLink()
    val s = load.data
    PollDeployJob(hub, job, reload)
    val started = { j: DeployJob? -> if (j != null) job.value = j }

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Deploy", onBack, sub = s?.app) { IconBtn("refresh", "Refresh", reload) }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                if (load.error.contains("no deploy app")) item { EmptyState("No deploy app here", "This repo has no .deploy/app.yaml", action = { SetupButton(hub, "deploy") }, icon = "rocket") }
                else item { ErrorHint(load.error) }
                if (s == null && load.error.isEmpty()) item { Loading("Loading…") }
                if (s != null) deployEnvs(s, System.currentTimeMillis(), link, hub, started, { app = it }) { ask = it }
                job.value?.let { deployJobSection(it, link) { job.value = null } }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
    ask?.let { a ->
        if (a.input != null) TextDialog(a.title, a.input, a.action, { v -> if (v.isNotBlank()) a.run(v.trim()) }, onDismiss = { ask = null }, detail = a.detail)
        else ConfirmDialog(a.title, a.detail, a.action, { a.run("") }, danger = true, onDismiss = { ask = null })
    }
}

private fun LazyListScope.deployEnvs(s: DeployStatus, now: Long, link: (String) -> Unit, hub: Hub, started: (DeployJob?) -> Unit, onApp: (String) -> Unit, onAsk: (DeployAsk) -> Unit) {
    item {
        SectionHeader(s.app.ifEmpty { "Deploy" }, action = if (s.apps.size > 1) ({ MoreButton("Switch app") { close -> s.apps.forEach { a -> MenuItem(a, "rocket", { close(); onApp(a) }, checked = a == s.app) } } }) else null)
    }
    item {
        Group {
            s.envs.forEachIndexed { i, env ->
                if (i > 0) Hairline()
                EnvRow(env, s, now, link, hub, started, onAsk)
            }
        }
    }
    if (s.serviceUrl.isNotEmpty()) item { Group(Modifier.padding(top = Tokens.sp6)) { ListRow("Open in the deploy service", onClick = { link(s.serviceUrl) }) } }
}

@Composable
private fun EnvRow(env: DeployEnv, s: DeployStatus, now: Long, link: (String) -> Unit, hub: Hub, started: (DeployJob?) -> Unit, onAsk: (DeployAsk) -> Unit) {
    val warn = deployWarning(env)
    fun deploy(ref: String?) {
        onAsk(DeployAsk(
            "Deploy to ${env.label}?",
            (if (ref != null) "Deploys ${shortSha(ref)} (HEAD of ${s.head.branch}) of ${s.app} to ${env.label} through the deploy service." else "Branch or commit of ${s.app} to deploy to ${env.label} through the deploy service.") + (warn?.let { " $it" } ?: ""),
            "Deploy", { v -> hub.runDeploy(s.app, env.name, ref ?: v, started) }, if (ref == null) s.head.branch else null,
        ))
    }
    fun rollBack() {
        val to = env.rollbackTo
        val d = env.deployed
        if (to != null && d != null) onAsk(DeployAsk(
            "Roll back ${env.label}?",
            "Redeploys ${shortSha(to.sha)} (deployed ${agoShort(isoMillis(to.at), now, " ago")}) in place of ${shortSha(d.sha)}." + (warn?.let { " $it" } ?: ""),
            "Roll back", { hub.rollbackDeploy(s.app, env.name, to.sha, started) },
        ))
    }
    ListRow(env.label, envMetaLine(env, s, now), trailing = {
        Button("Deploy", { deploy(s.head.sha) }, size = ButtonSize.Sm)
        MoreButton { close ->
            MenuItem("Deploy a branch or commit…", "rocket", { close(); deploy(null) })
            env.deployed?.let { d -> MenuItem("Open ${shortSha(d.sha)} on GitHub", "link-external", { close(); link("https://github.com/${s.repo}/commit/${d.sha}") }) }
            MenuItem("Roll back", "discard", { close(); rollBack() }, enabled = env.rollbackTo != null && env.deployed != null)
        }
    })
}

private fun LazyListScope.deployJobSection(j: DeployJob, link: (String) -> Unit, onClose: () -> Unit) {
    item {
        SectionHeader(
            "Deploy",
            action = {
                Badge(if (!j.done) "Deploying" else if (j.ok) "Deployed" else "Failed", if (!j.done) BadgeTone.Running else if (j.ok) BadgeTone.Done else BadgeTone.Failed)
                if (j.done) Button("Close", onClose, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            },
        )
    }
    item {
        Group {
            Text(j.lines.joinToString("\n"), Modifier.horizontalScroll(rememberScrollState()).padding(Tokens.sp6), style = Mono, color = av.fg, softWrap = false)
            if (j.url.isNotEmpty()) ListRow("Open in the deploy service", onClick = { link(j.url) })
        }
    }
}

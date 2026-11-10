package no.pradhan.agentview.nativeapp.net

import no.pradhan.agentview.nativeapp.ops.DeployJob
import no.pradhan.agentview.nativeapp.ops.DeployStatus
import no.pradhan.agentview.nativeapp.ops.Finding
import no.pradhan.agentview.nativeapp.ops.GrafanaDashboards
import no.pradhan.agentview.nativeapp.ops.GrafanaLogs
import no.pradhan.agentview.nativeapp.ops.GrafanaPanels
import no.pradhan.agentview.nativeapp.ops.GrafanaPatterns
import no.pradhan.agentview.nativeapp.ops.McpConnector
import no.pradhan.agentview.nativeapp.ops.McpServer
import no.pradhan.agentview.nativeapp.ops.ObserveInfo
import no.pradhan.agentview.nativeapp.ops.ReviewFindings
import no.pradhan.agentview.nativeapp.ops.deployBody
import no.pradhan.agentview.nativeapp.ops.dismissBody
import no.pradhan.agentview.nativeapp.ops.mcpGroupBody
import no.pradhan.agentview.nativeapp.ops.parseConnectors
import no.pradhan.agentview.nativeapp.ops.parseDeploy
import no.pradhan.agentview.nativeapp.ops.parseDeployJob
import no.pradhan.agentview.nativeapp.ops.parseFindings
import no.pradhan.agentview.nativeapp.ops.parseMcp
import no.pradhan.agentview.nativeapp.ops.parseObserve
import no.pradhan.agentview.nativeapp.ops.rollbackBody
import no.pradhan.agentview.nativeapp.workspace.PullRequest
import no.pradhan.agentview.nativeapp.workspace.PullRequestDetail
import no.pradhan.agentview.nativeapp.workspace.parsePullDetail
import no.pradhan.agentview.nativeapp.workspace.parsePulls

suspend fun Hub.deployJob(id: String): DeployJob = parseDeployJob(read("/api/deploy/job/$id"))

suspend fun Hub.deployStatus(app: String): DeployStatus = parseDeploy(read("/api/deploy/status" + if (app.isNotEmpty()) "?app=${enc(app)}" else ""))

fun Hub.runDeploy(app: String, env: String, ref: String, done: (DeployJob?) -> Unit) =
    write("/api/deploy/run", deployBody(app, env, ref), "Could not start the deploy", ::parseDeployJob, done)

fun Hub.rollbackDeploy(app: String, env: String, sha: String, done: (DeployJob?) -> Unit) =
    write("/api/deploy/rollback", rollbackBody(app, env, sha), "Could not start the deploy", ::parseDeployJob, done)

suspend fun Hub.reviewFindings(target: String): ReviewFindings? = parseFindings(read("/api/findings?target=${enc(target)}"))

fun Hub.dismissFinding(target: String, f: Finding, done: (ReviewFindings?) -> Unit) =
    write("/api/findings/dismiss", dismissBody(target, f), "Could not dismiss the finding", ::parseFindings, done)

suspend fun Hub.pulls(fresh: Boolean): List<PullRequest> = parsePulls(read("/api/gh/prs" + if (fresh) "?fresh=1" else ""))

suspend fun Hub.pullDetail(number: Int): PullRequestDetail = parsePullDetail(read("/api/gh/pr/$number"))

fun Hub.actOnPull(number: Int, action: String, body: String, failure: String, done: (Boolean) -> Unit) =
    write("/api/gh/pr/$number/$action", body, failure, done)

suspend fun Hub.observe(repo: String): ObserveInfo = parseObserve(read("/api/observe" + if (repo.isNotEmpty()) "?repo=${enc(repo)}" else ""))

fun Hub.saveObserveConfig(body: String, done: (Boolean) -> Unit) = write("/api/observe/config", body, "Could not save the settings", done)

suspend fun Hub.grafanaDashboards(repo: String): GrafanaDashboards =
    protocolJson.decodeFromString(GrafanaDashboards.serializer(), read("/api/observe/grafana/dashboards?repo=${enc(repo)}"))

suspend fun Hub.grafanaPanels(repo: String): GrafanaPanels =
    protocolJson.decodeFromString(GrafanaPanels.serializer(), read("/api/observe/grafana/panels?repo=${enc(repo)}"))

suspend fun Hub.grafanaLogs(repo: String): GrafanaLogs =
    protocolJson.decodeFromString(GrafanaLogs.serializer(), read("/api/observe/grafana/logs?repo=${enc(repo)}"))

suspend fun Hub.grafanaPatterns(repo: String): GrafanaPatterns =
    protocolJson.decodeFromString(GrafanaPatterns.serializer(), read("/api/observe/grafana/patterns?repo=${enc(repo)}"))

suspend fun Hub.mcpConnectors(refresh: Boolean): Map<String, List<McpConnector>> = parseConnectors(read("/api/mcp/connectors" + if (refresh) "?refresh=1" else ""))

suspend fun Hub.mcpProbe(refresh: Boolean): List<McpServer> = parseMcp(read("/api/mcp/probe" + if (refresh) "?refresh=1" else ""))

fun Hub.saveMcpGroup(service: String, group: String, done: (Boolean) -> Unit) =
    write("/api/mcp/groups", mcpGroupBody(service, group), "Could not save the group", done)

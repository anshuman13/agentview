package no.pradhan.agentview.nativeapp.net

import no.pradhan.agentview.nativeapp.app.parseMacs
import no.pradhan.agentview.nativeapp.chat.MemoryFile
import no.pradhan.agentview.nativeapp.chat.MessageHit
import no.pradhan.agentview.nativeapp.chat.Todos
import no.pradhan.agentview.nativeapp.codex.autopilot.parseRunDiff
import no.pradhan.agentview.nativeapp.sessions.AdvisorInfo
import no.pradhan.agentview.nativeapp.sessions.AuditInfo
import no.pradhan.agentview.nativeapp.sessions.BacklogItem
import no.pradhan.agentview.nativeapp.sessions.SpecHomeItem
import no.pradhan.agentview.nativeapp.sessions.parseBuild
import no.pradhan.agentview.nativeapp.workspace.DevPort
import no.pradhan.agentview.nativeapp.workspace.DevScript
import no.pradhan.agentview.nativeapp.workspace.OpenedPort
import no.pradhan.agentview.nativeapp.workspace.parseBranchDiff
import no.pradhan.agentview.nativeapp.workspace.parseDir
import no.pradhan.agentview.nativeapp.workspace.parseFile
import no.pradhan.agentview.nativeapp.workspace.parseGitStatus
import no.pradhan.agentview.nativeapp.workspace.parseSketches
import no.pradhan.agentview.nativeapp.workspace.parseTerms

// The server reads the screens make, so their paths live in net/ (web: each feature's API file).
suspend fun Hub.readFile(path: String, chat: String = pageChat) = parseFile(api.get("/api/file?path=${enc(path)}", chat))
suspend fun Hub.readDir(path: String) = parseDir(read("/api/dir?path=${enc(path)}"))
suspend fun Hub.chatFiles(chat: String): List<String> = protocolJson.decodeFromString(api.get("/api/files", chat))
suspend fun Hub.gitStatus() = parseGitStatus(read("/api/git/status"))
suspend fun Hub.branchDiff() = parseBranchDiff(read("/api/git/branch"))
suspend fun Hub.gitTodos() = protocolJson.decodeFromString<Todos>(read("/api/git/todos")).todos
fun Hub.git(action: String, body: String, failure: String, done: (Boolean) -> Unit) = write("/api/git/$action", body, failure, done)
suspend fun Hub.terminals() = parseTerms(read("/api/terms"))
fun Hub.newTerminal(failure: String, dev: Boolean = false, done: (Boolean) -> Unit) = write(if (dev) "/api/terms?dev=1" else "/api/terms", "", failure, done)
suspend fun Hub.sketches() = parseSketches(read("/api/sketches"))
suspend fun Hub.ports(): List<DevPort> = protocolJson.decodeFromString(api.get("/api/ports"))
suspend fun Hub.openPort(port: Int): OpenedPort = protocolJson.decodeFromString(api.get("/api/ports/open?port=$port"))
suspend fun Hub.devScript(): DevScript? = protocolJson.decodeFromString(read("/api/devscript"))
suspend fun Hub.memoryFiles(): List<MemoryFile> = protocolJson.decodeFromString(read("/api/memory"))
suspend fun Hub.macs(origin: String) = parseMacs(read("/api/connect"), origin)
suspend fun Hub.searchMessages(q: String): List<MessageHit> = protocolJson.decodeFromString(read("/api/sessions/search?q=${enc(q)}"))
suspend fun Hub.runDiff(run: String) = parseRunDiff(read("/api/runs/diff?run=${enc(run)}"))
suspend fun Hub.advisors(): List<AdvisorInfo> = protocolJson.decodeFromString(read("/api/advisors"))
suspend fun Hub.backlog(root: String): List<BacklogItem> = protocolJson.decodeFromString(read("/api/advisors/backlog?root=${enc(root)}"))
suspend fun Hub.specs(root: String): List<SpecHomeItem> = protocolJson.decodeFromString(read("/api/advisors/specs?root=${enc(root)}"))
suspend fun Hub.audit(root: String): AuditInfo? = protocolJson.decodeFromString(read("/api/advisors/audit?root=${enc(root)}"))
suspend fun Hub.postBuildReview(slug: String, decision: String, phase: String? = null, note: String? = null) { api.postReview(pageChat, slug, decision, phase, note) }

// The build, or null when the server has no such spec any more.
suspend fun Hub.build(slug: String) = try { parseBuild(read("/api/builds/one?slug=${enc(slug)}")) } catch (e: ApiError) { if (e.code == 404) null else throw e }

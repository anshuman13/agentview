package no.pradhan.agentview.nativeapp.app

import androidx.lifecycle.viewModelScope
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.chat.MemoryFile
import no.pradhan.agentview.nativeapp.chat.MessageHit
import no.pradhan.agentview.nativeapp.codex.autopilot.parseGitLog
import no.pradhan.agentview.nativeapp.codex.autopilot.parseRunDiff
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.workspace.parseBranchDiff
import no.pradhan.agentview.nativeapp.workspace.parseCommitDiff
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
suspend fun Hub.commitDiff(hash: String) = parseCommitDiff(read("/api/git/show?hash=${enc(hash)}"))
fun Hub.git(action: String, body: String, failure: String, done: (Boolean) -> Unit) = write("/api/git/$action", body, failure, done)
suspend fun Hub.terminals() = parseTerms(read("/api/terms"))
fun Hub.newTerminal(failure: String, done: (Boolean) -> Unit) = write("/api/terms", "", failure, done)
suspend fun Hub.sketches() = parseSketches(read("/api/sketches"))
suspend fun Hub.memoryFiles(): List<MemoryFile> = protocolJson.decodeFromString(read("/api/memory"))
suspend fun Hub.macs(origin: String) = parseMacs(read("/api/connect"), origin)
suspend fun Hub.searchMessages(q: String): List<MessageHit> = protocolJson.decodeFromString(read("/api/sessions/search?q=${enc(q)}"))
suspend fun Hub.runDiff(run: String) = parseRunDiff(read("/api/runs/diff?run=${enc(run)}"))
suspend fun Hub.runCommits(run: ChatRun) = parseGitLog(api.get("/api/git/log?since=${run.startedAt}", run.chatId))

private val linkTitles = ConcurrentHashMap<String, Deferred<String?>>()
private val linkSlots = Semaphore(3)

// linkTitle of web/src/codex/data/ask/links.ts: one request per URL per app run, at most 3 at once; a failed request stays null.
suspend fun Hub.linkTitle(url: String): String? = linkTitles.computeIfAbsent(url) {
    viewModelScope.async {
        linkSlots.withPermit { runCatching { protocolJson.parseToJsonElement(read("/api/link-title?url=${enc(url)}")).jsonObject["title"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } }.getOrNull() }
    }
}.await()

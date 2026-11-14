package no.pradhan.agentview.nativeapp.sessions

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import no.pradhan.agentview.nativeapp.ui.select
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.codex.autopilot.ADVISOR_LOOP_BUILDS
import no.pradhan.agentview.nativeapp.codex.autopilot.buildsLine
import no.pradhan.agentview.nativeapp.codex.autopilot.ADVISOR_LOOP_CAP
import no.pradhan.agentview.nativeapp.codex.autopilot.ADVISOR_LOOP_EVERY
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalForm
import no.pradhan.agentview.nativeapp.codex.autopilot.everyText
import no.pradhan.agentview.nativeapp.codex.autopilot.firstRoundText
import no.pradhan.agentview.nativeapp.codex.autopilot.goalCommand
import no.pradhan.agentview.nativeapp.codex.autopilot.openRun
import no.pradhan.agentview.nativeapp.codex.autopilot.outcomeDot
import no.pradhan.agentview.nativeapp.codex.autopilot.roundText
import no.pradhan.agentview.nativeapp.codex.autopilot.runNeedsYou
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.newChat
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.RowLabel
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.buildItemPrompt
import no.pradhan.agentview.nativeapp.workspace.buildSpecPrompt
import no.pradhan.agentview.nativeapp.workspace.sketchSpecPrompt
import no.pradhan.agentview.nativeapp.workspace.rememberLoad

// What the Advisors page shows of each, from /api/advisors.
@Serializable
data class AdvisorChat(val sessionId: String, val title: String = "", val lastModified: Long = 0)

@Serializable
data class AdvisorInfo(val id: String, val memory: String = "", val chats: List<AdvisorChat> = emptyList())

// One line of a project's .claude/backlog.md, from /api/advisors/backlog; mirrors BacklogItem in shared/advisors.ts.
@Serializable
data class BacklogItem(val rank: Int, val slug: String, val title: String, val why: String = "", val status: String, val spec: Boolean = false)

internal fun advisorLoopGoal(root: String) = "Advisor loop for $root, never met on its own. Each round, as PM: reread $root/.claude/backlog.md. If fewer than 2 items are specced, write the spec for the top proposed item to $root/.claude/specs/<slug>.md and mark it specced; for a UI change ask the Designer advisor for a sketch, and say in the ROUND line if you cannot reach it. If a spec awaits my approval, end with ROUND: question <what needs approval>. Once I approve, start the build with mcp__agentview__start_build on the spec's path and mark the item building; one build in flight per project; mark it done when merged, and if its spec has a Fixes: line ask the Designer advisor to recheck those findings, and say in the ROUND line if you cannot reach it. A claimed finding the Designer leaves open goes back to proposed, keeping its slug: next round move that line from done back to proposed and note the finding in the why. If the backlog is empty, ask the Designer for an audit when the newest $root/.claude/audits/*.md is over 7 days old, else end with ROUND: nothing."

internal fun advisorLoopCommand(root: String, now: Long) =
    goalCommand(GoalForm(advisorLoopGoal(root), ADVISOR_LOOP_EVERY, null, null, ADVISOR_LOOP_CAP, ADVISOR_LOOP_BUILDS), now)

// The project the page shows before one is picked: web defaultAdvisorRoot in shared/advisors.ts.
internal fun defaultAdvisorRoot(openRoot: String?, repos: List<Pair<String, Long>>): String? =
    if (openRoot != null && repos.any { it.first == openRoot }) openRoot else repos.fold(null as Pair<String, Long>?) { best, r -> if (best == null || r.second > best.second) r else best }?.first

// The project picked from the menus, kept across visits like chosenRoot on web.
private var advisorPick: String? = null

internal fun advisorLoopOf(runs: List<ChatRun>, root: String): ChatRun? {
    val head = "Advisor loop for ${root.trimEnd('/')},"
    return runs.filter { it.kind == "goal" && it.state != "done" && it.what.startsWith(head) }.maxByOrNull { it.startedAt }
}

// The PM chat runs one goal at a time, so the loop of another project blocks a new one: that project's folder.
internal fun advisorLoopElsewhere(runs: List<ChatRun>, root: String): String? {
    val head = "Advisor loop for ${root.trimEnd('/')},"
    return runs.firstOrNull { it.kind == "goal" && it.state != "done" && it.what.startsWith("Advisor loop for ") && !it.what.startsWith(head) }?.what?.drop(17)?.substringBefore(',')
}

internal fun advisorLoopLine(run: ChatRun): String {
    val last = run.rounds.lastOrNull()
    return when {
        run.state == "paused" -> if (run.why.isEmpty()) "Paused" else "Paused · ${run.why}"
        last?.report != null -> "Weekly report"
        last != null -> roundText(last)
        run.nextAt != null -> firstRoundText(run.nextAt)
        else -> "Waiting for its first round"
    }
}


// One card of the Advisors board: web BoardCard in shared/advisors.ts. action is spec-it, approve, open-chat, sketch, build or null.
internal data class BoardCard(val slug: String, val action: String?, val needsYou: Boolean, val item: BacklogItem?, val spec: SpecHomeItem?)

internal data class AdvisorBoard(val stages: Map<String, List<BoardCard>>, val defaultStage: String)

internal val BOARD_STAGES = listOf("ideas", "specced", "building", "done")

private fun specNeedsYou(s: SpecHomeItem) = s.waiting || s.hold || s.state == "waiting"

private fun stageOf(item: BacklogItem?, spec: SpecHomeItem?): String? = when {
    spec?.pipeline == "merged" || item?.status == "done" -> "done"
    spec?.built == true || item?.status == "building" -> "building"
    spec != null || item?.status == "specced" -> "specced"
    item?.status == "proposed" -> "ideas"
    else -> null
}

private fun actionOf(stage: String, spec: SpecHomeItem?): String? {
    if (stage == "ideas") return "spec-it"
    if (stage == "done") return null
    fun chat(a: String) = if (spec?.chat != null || spec?.session != null) a else null
    return when {
        stage == "building" -> if (spec != null) chat("open-chat") else null
        spec == null -> "build"
        spec.waiting -> chat("approve")
        spec.hold || spec.state in listOf("running", "failed", "waiting") -> chat("open-chat")
        spec.sketched -> "build"
        else -> "sketch"
    }
}

// What the board shows for a project: web advisorBoard in shared/advisors.ts.
internal fun advisorBoard(backlog: List<BacklogItem>, specs: List<SpecHomeItem>, loopNeedsYou: Boolean): AdvisorBoard {
    val stages = BOARD_STAGES.associateWith { mutableListOf<BoardCard>() }
    val specOf = specs.associateBy { it.slug }
    val itemOf = backlog.associateBy { it.slug }
    fun card(stage: String, slug: String, item: BacklogItem?, spec: SpecHomeItem?) = BoardCard(slug, actionOf(stage, spec), stage != "done" && spec != null && specNeedsYou(spec), item, spec)
    val lines = backlog.sortedBy { it.rank }.mapNotNull { item -> stageOf(item, specOf[item.slug])?.let { Triple(it, item, specOf[item.slug]) } }
    for (stage in listOf("ideas", "specced")) for ((st, item, spec) in lines) if (st == stage) stages.getValue(stage) += card(stage, item.slug, item, spec)
    val ordered = specHomeOrder(specs).map { Triple(it, itemOf[it.slug], stageOf(itemOf[it.slug], it)!!) }
    for ((spec, item, stage) in ordered) if (item == null && stage == "specced") stages.getValue(stage) += card(stage, spec.slug, null, spec)
    for ((spec, item, stage) in ordered) if (stage == "building" || stage == "done") stages.getValue(stage) += card(stage, spec.slug, item, spec)
    for ((stage, item, spec) in lines) if (spec == null && (stage == "building" || stage == "done")) stages.getValue(stage) += card(stage, item.slug, item, null)
    val defaultStage = BOARD_STAGES.firstOrNull { st -> stages.getValue(st).any { it.needsYou } || (st == "building" && loopNeedsYou) } ?: BOARD_STAGES.firstOrNull { stages.getValue(it).isNotEmpty() } ?: "ideas"
    return AdvisorBoard(stages, defaultStage)
}

private val STAGE_LABEL = mapOf("ideas" to "Ideas", "specced" to "Specced", "building" to "Building", "done" to "Done")
private val ACTION_LABEL = mapOf("spec-it" to "Spec it", "approve" to "Approve", "open-chat" to "Open chat", "sketch" to "Sketch", "build" to "Build")

// The Advisor loop card, first in Building: its last round and Open chat; with no loop, Start sends its goal to the PM chat, disabled for 10 s.
@Composable
private fun LoopCard(hub: Hub, project: String, loop: ChatRun?, starting: Boolean, onStart: () -> Unit, go: (suspend () -> Boolean) -> Unit) {
    if (loop == null) {
        ListRow(
            "Advisor loop", "Not running · every ${everyText(ADVISOR_LOOP_EVERY)} · up to $ADVISOR_LOOP_BUILDS builds",
            state = if (hub.readOnly) null else ({ Button("Start", onStart, variant = ButtonVariant.Tinted, size = ButtonSize.Sm, enabled = !starting) }),
            stateSlot = !hub.readOnly, lines = 1, metaLines = 1,
        )
        return
    }
    val last = loop.rounds.lastOrNull()
    val builds = buildsLine(loop)
    ListRow(
        "Advisor loop", advisorLoopLine(loop),
        leading = last?.let { { StatusDot(outcomeDot(it.outcome)) } },
        state = if (runNeedsYou(loop)) ({ Badge(HOLD_BADGE.first, HOLD_BADGE.second) }) else null,
        trailing = if (builds.isEmpty()) null else ({ RowLabel(builds) }),
        below = if (hub.readOnly) null else ({ Button("Open chat", { go { hub.openRun(loop, last?.report) } }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm) }),
        lines = 1, metaLines = 1,
    )
}

// A backlog line or spec: its action opens the build chat (with its Spec sheet for Approve when that chat is live), More holds the other next steps and the move.
@Composable
private fun BoardCardRow(hub: Hub, card: BoardCard, stage: String, project: String, live: Boolean, openSlugs: List<String>, move: (String, String) -> Unit, onOpen: () -> Unit, scope: CoroutineScope, go: (suspend () -> Boolean) -> Unit) {
    val spec = card.spec
    val item = card.item
    fun newChat(text: String) = hub.newChat(project, text = text, hub = true, onOpened = onOpen)
    val sketch = { newChat(sketchSpecPrompt(".claude/specs/${card.slug}.md")) }
    val build = { newChat(if (spec != null || item!!.spec) buildSpecPrompt(".claude/specs/${card.slug}.md") else buildItemPrompt(item!!.title, item.why, item.slug)) }
    fun openChat(sheet: Boolean) {
        if (live) { hub.open(spec!!.chat!!); if (sheet) hub.showSpec(card.slug); onOpen() } else go { hub.openSaved(spec!!.session!!) }
    }
    val run = when (card.action) {
        "spec-it" -> ({ scope.askAdvisor(hub, "pm", specItemPrompt(project, item!!), onOpen) })
        "approve" -> ({ openChat(true) })
        "open-chat" -> ({ openChat(false) })
        "sketch" -> sketch
        else -> build
    }
    val at = if (item != null && item.status != "done") openSlugs.indexOf(card.slug) else -1
    val showBuild = if (stage == "ideas") item != null && (item.status == "proposed" || item.status == "specced") else stage == "specced" && card.action != "build"
    val showSketch = stage == "specced" && spec != null && !spec.sketched && card.action != "sketch"
    val badge = when {
        spec == null || stage == "done" -> null
        spec.waiting || spec.hold || spec.state == "waiting" -> HOLD_BADGE
        spec.state == "running" -> "Running" to BadgeTone.Running
        spec.state == "failed" -> "Failed" to BadgeTone.Failed
        else -> null
    }
    val parts = spec?.let { specRowParts(it) { t -> since(t) } }
    ListRow(
        spec?.title?.ifEmpty { null } ?: item!!.title, parts?.meta ?: item!!.why,
        lines = 1, metaLines = 1,
        state = badge?.let { (text, tone) -> { Badge(text, tone) } },
        trailing = if (parts == null || parts.age.isEmpty()) null else ({ RowLabel(parts.age) }),
        below = if (card.action == null || hub.readOnly) null else ({ Button(ACTION_LABEL.getValue(card.action), run, variant = ButtonVariant.Tinted, size = ButtonSize.Sm) }),
        menu = if (hub.readOnly || !(showBuild || showSketch || at >= 0)) null else ({ dismiss ->
            if (showSketch) MenuItem("Sketch", "paintcan", { dismiss(); sketch() })
            if (showBuild) MenuItem("Build", "play", { dismiss(); build() })
            if (at >= 0) {
                MenuItem("Move up", "arrow-up", { dismiss(); move(card.slug, "up") }, enabled = at > 0)
                MenuItem("Move down", "arrow-down", { dismiss(); move(card.slug, "down") }, enabled = at < openSlugs.size - 1)
            }
        }),
    )
}

private fun rankPrompt(root: String) = "Read $root/.claude/backlog.md and the project's code and recent changes, then rank what to build next. Rewrite the backlog file (at most 10 lines) and reply with the top three."

internal fun specItemPrompt(root: String, item: BacklogItem) = "Write the spec for the backlog item \"${item.title}\" (${item.why}) to $root/.claude/specs/${item.slug}.md and mark its line specced in $root/.claude/backlog.md."

// The newest .claude/audits/<date>.md, from /api/advisors/audit; mirrors Audit in shared/advisors.ts.
@Serializable
data class AuditFinding(val rank: Int, val screen: String, val problem: String, val severity: String, val fix: String, val status: String = "open", val by: String = "")

internal fun auditCountLine(findings: List<AuditFinding>): String {
    if (findings.isEmpty()) return "No findings"
    val open = findings.count { it.status != "fixed" }
    return if (open == findings.size) "$open open" else "$open open of ${findings.size}"
}

@Serializable
data class AuditInfo(val date: String, val path: String, val findings: List<AuditFinding> = emptyList())

private fun auditPrompt(root: String) = "Audit the usability of the app in $root. If it has no running app, say so and write no file. Otherwise start it with the project's own start command, then walk each screen in headless Chrome on port 9334 (never 9333) at 390px wide, then at 1280px, and clean up the browser and the app when done. Write $root/.claude/audits/<YYYY-MM-DD>.md with today's date: at most 15 findings, ranked, one per line as `<rank>. <screen> | <problem in one line> | <severity high|med|low> | <fix in one line>`. Reply with the top three."

private fun specsFromAuditPrompt(root: String) = "Read the newest file in $root/.claude/audits and add its top findings to $root/.claude/backlog.md as `proposed` lines, with the audit line as the why. Skip findings marked fixed and ones a done backlog line names. A spec written from a finding has a line Fixes: <audit date> #<rank>, #<rank> under its title. Keep the existing lines, reread the file before you edit it and renumber the ranks. Reply with the lines you added."

// Opens an advisor's chat and sends it a prompt, then calls onOpen.
internal fun CoroutineScope.askAdvisor(hub: Hub, id: String, text: String, onOpen: () -> Unit) {
    launch { if (hub.askAdvisor(id, text)) onOpen() }
}

// The facts in a memory file: its list lines.
private val FACT = Regex("""^\s*[-*] """)

fun memoryFacts(memory: String) = memory.lines().count { FACT.containsMatchIn(it) }

// Advisors (web/src/sessions/Advisors.tsx): one project's board from idea to merged build as chips with one stage, the Ask buttons, and a sheet with each advisor's conversations and memory.
@Composable
fun AdvisorsScreen(hub: Hub, onBack: () -> Unit, onOpen: () -> Unit) {
    // Fields, not the whole state, so a streamed event in the open chat does not recompose the board.
    val live by hub.store.state.select { it.live }
    val runs by hub.store.state.select { it.runs }
    val shownId by hub.store.state.select { it.shownId }
    val sessionCwd by hub.store.state.select { it.session?.cwd }
    val ws by hub.workspace.collectAsState()
    // Reloads after an advisor's turn, which may have changed its memory, the backlog, a spec or the audit.
    val turns = live.filter { advisorOf(it.cwd) != null && !it.running }.joinToString { "${it.id}:${it.lastActive}" }
    val (load, reload) = rememberLoad { protocolJson.decodeFromString<List<AdvisorInfo>>(hub.read("/api/advisors")) }
    var memory by rememberSaveable { mutableStateOf<String?>(null) }
    var picked by remember { mutableStateOf(advisorPick) }
    val shownChat = live.firstOrNull { it.id == shownId }
    val openCwd = sessionCwd ?: shownChat?.cwd
    val root = picked ?: defaultAdvisorRoot(openCwd?.let { folderKey(it, ws.repos, ws.trees) }, remember(ws) {
        // web folders(): a repo's last commit or its newest saved chat, whichever is later.
        val chats = ws.saved.groupBy { folderKey(it.cwd, ws.repos, ws.trees) }.mapValues { (_, l) -> l.maxOf { it.lastModified } }
        ws.repos.map { it.cwd to maxOf(it.lastCommit.toLong(), chats[it.cwd] ?: 0L) }
    })
    val (backlog, reloadBacklog) = rememberLoad(root) { root?.let { protocolJson.decodeFromString<List<BacklogItem>>(hub.read("/api/advisors/backlog?root=${java.net.URLEncoder.encode(it, "UTF-8")}")) } }
    val (specs, reloadSpecs) = rememberLoad(root) { root?.let { protocolJson.decodeFromString<List<SpecHomeItem>>(hub.read("/api/advisors/specs?root=${java.net.URLEncoder.encode(it, "UTF-8")}")) } }
    var moved by remember(root, backlog.data) { mutableStateOf<List<BacklogItem>?>(null) }
    val (audits, reloadAudit) = rememberLoad(root) { root?.let { listOfNotNull(protocolJson.decodeFromString<AuditInfo?>(hub.read("/api/advisors/audit?root=${java.net.URLEncoder.encode(it, "UTF-8")}"))) } }
    var loadedTurns by remember { mutableStateOf(turns) }
    LaunchedEffect(turns) { if (turns != loadedTurns) { loadedTurns = turns; reload(); reloadBacklog(); reloadSpecs(); reloadAudit() } }
    var auditOpen by rememberSaveable { mutableStateOf(false) }
    var sheetOpen by rememberSaveable { mutableStateOf(false) }
    var starting by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(starting) { if (starting) { delay(10_000); starting = false } }
    var chip by remember(root) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun go(open: suspend () -> Boolean) = scope.launch { if (open()) onOpen() }
    val items = moved ?: backlog.data
    val specList = specs.data
    val loop = root?.let { advisorLoopOf(runs, it) }
    val board = if (items != null && specList != null) advisorBoard(items, specList, loop != null && runNeedsYou(loop)) else null
    LaunchedEffect(board != null) { if (board != null && chip == null) chip = board.defaultStage }
    Column(Modifier.fillMaxSize()) {
        PageHeader("Advisors", onBack, actions = { IconBtn("refresh", "Refresh", reload) })
        PageBody {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                SectionHeader(root?.let { folderName(it) } ?: "Project", action = {
                    MoreButton("Project") { dismiss -> for (r in ws.repos) MenuItem(folderName(r.cwd), "repo", { dismiss(); advisorPick = r.cwd; picked = r.cwd }, checked = r.cwd == root) }
                })
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.listPad), horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
                    for (a in ADVISORS) Button("Ask ${a.name}", { go { hub.openAdvisor(a.id, false) } }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                    Button("Conversations and memory", { sheetOpen = true }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, icon = "comment-discussion")
                }
                val project = root
                when {
                    project == null -> Group { ListRow("Pick a project to see its work", lines = 1) }
                    backlog.error.isNotEmpty() || specs.error.isNotEmpty() -> EmptyState("Could not load the board", icon = "list-ordered")
                    board == null || items == null || specList == null -> Loading("Loading board")
                    else -> {
                        val stage = chip ?: board.defaultStage
                        val openSlugs = items.filter { it.status != "done" }.sortedBy { it.rank }.map { it.slug }
                        val move = { slug: String, dir: String -> scope.launch { runCatching { hub.api.moveBacklog(project, slug, dir) }.onSuccess { moved = it }.onFailure { hub.notice.value = "Could not move the item" } }; Unit }
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                            for (s in BOARD_STAGES) Chip(listOfNotNull(STAGE_LABEL.getValue(s), board.stages.getValue(s).size.takeIf { it > 0 }).joinToString(" "), { chip = s }, on = s == stage)
                        }
                        val cards = board.stages.getValue(stage)
                        val audit = audits.data?.firstOrNull()
                        val running = live.any { advisorOf(it.cwd)?.id == "designer" && it.running }
                        val nothing = items.isEmpty()
                        if (stage == "building" || stage == "ideas" || cards.isNotEmpty()) Group {
                            if (stage == "building") LoopCard(hub, project, loop, starting, {
                                val elsewhere = advisorLoopElsewhere(runs, project)
                                if (elsewhere != null) hub.notice.value = "The loop runs for ${elsewhere.substringAfterLast('/')}; stop it there first"
                                else { starting = true; scope.askAdvisor(hub, "pm", advisorLoopCommand(project, System.currentTimeMillis()), onOpen) }
                            }, ::go)
                            if (stage == "ideas") ListRow(
                                "Audit", when {
                                    audits.data == null && audits.error.isNotEmpty() -> "Could not load the audit"
                                    audits.data == null -> "Loading the audit"
                                    else -> audit?.let { "${it.date} · ${auditCountLine(it.findings)}" } ?: "Not run yet"
                                },
                                lines = 1, metaLines = 1,
                                state = if (hub.readOnly && !running) null else ({
                                    if (running) Badge("Running", BadgeTone.Running)
                                    else Button("Specs from audit", { scope.askAdvisor(hub, "pm", specsFromAuditPrompt(project), onOpen) }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm, enabled = audit != null)
                                }),
                                menu = if (hub.readOnly) null else ({ dismiss ->
                                    MenuItem("Open latest audit", "list-flat", { dismiss(); auditOpen = true }, enabled = audit != null)
                                    MenuItem("Run audit", "play", { dismiss(); scope.askAdvisor(hub, "designer", auditPrompt(project), onOpen) }, enabled = !running)
                                }),
                            )
                            for (c in cards) BoardCardRow(hub, c, stage, project, live.any { it.id == c.spec?.chat }, openSlugs, move, onOpen, scope, ::go)
                        }
                        if (stage == "ideas" && nothing) EmptyState("No backlog yet", "The PM ranks what to build next", "list-ordered", action = if (hub.readOnly) null else ({
                            Button("Ask PM to rank", { scope.askAdvisor(hub, "pm", rankPrompt(project), onOpen) }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm)
                        })) else if (cards.isEmpty()) Text("Nothing here", Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), style = Type.meta, color = av.fgMuted)
                        if (auditOpen && audit != null) Sheet({ auditOpen = false }, "Audit, ${audit.date}", padded = false) {
                            for (f in audit.findings) ListRow(f.screen, "${if (f.status == "fixed") "Fixed · " else ""}${f.severity.replaceFirstChar { it.uppercase() }} · ${f.problem}. ${f.fix}", leading = { Text(f.rank.toString(), style = Type.callout, color = av.fgMuted) }, lines = 1, metaLines = 2)
                        }
                    }
                }
                Spacer(Modifier.padding(bottom = Tokens.sp16))
            }
        }
    }
    if (sheetOpen) Sheet({ sheetOpen = false }, "Conversations and memory", padded = false) {
        val info = load.data
        when {
            info == null && load.error.isNotEmpty() -> EmptyState("Could not load the advisors", load.error, icon = "organization")
            info == null -> Loading("Loading advisors")
            else -> for (a in ADVISORS) {
                val c = live.firstOrNull { advisorOf(it.cwd)?.id == a.id }
                val state = c?.let { chatState(it, null, ws.seen) }
                val got = info.firstOrNull { it.id == a.id }
                val earlier = got?.chats.orEmpty().filter { it.sessionId != c?.sessionId }
                val facts = memoryFacts(got?.memory.orEmpty())
                SectionHeader(a.name, a.model, action = { Button("New conversation", { go { hub.openAdvisor(a.id, true) } }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, icon = "add") })
                Group {
                    ListRow(
                        boldIf(state == ChatState.Done || state == ChatState.Needs, c?.title?.ifBlank { null } ?: "Talk to ${a.name}"),
                        when {
                            c == null -> a.hint
                            c.pending > 0 -> "Needs you"
                            c.running -> "Working"
                            else -> "Open · ${since(c.lastActive)}"
                        },
                        lines = 1, metaLines = 1, selected = c != null && c.id == shownId,
                        leading = if (state != null) ({ StateDot(state) }) else null,
                        onClick = { go { hub.openAdvisor(a.id, false) } },
                    )
                    for (s in earlier) {
                        Hairline()
                        ListRow(s.title.ifBlank { "Untitled" }, since(s.lastModified), lines = 1, onClick = { go { hub.openSaved(s.sessionId) } })
                    }
                    Hairline()
                    ListRow("Memory", if (facts == 0) "Nothing yet" else "$facts ${if (facts == 1) "fact" else "facts"}", lines = 1, onClick = if (facts > 0) ({ memory = if (memory == a.id) null else a.id }) else null)
                }
                if (memory == a.id && got != null) Markdown(got.memory.replaceFirst(Regex("^# .*\n"), ""), Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp4))
            }
        }
    }
}

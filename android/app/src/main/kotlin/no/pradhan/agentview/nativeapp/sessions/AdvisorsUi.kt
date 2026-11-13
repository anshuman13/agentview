package no.pradhan.agentview.nativeapp.sessions

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.newChat
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.read
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
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.buildItemPrompt
import no.pradhan.agentview.nativeapp.workspace.buildSpecPrompt
import no.pradhan.agentview.nativeapp.workspace.rememberLoad

// What the Advisors page shows of each, from /api/advisors.
@Serializable
data class AdvisorChat(val sessionId: String, val title: String = "", val lastModified: Long = 0)

@Serializable
data class AdvisorInfo(val id: String, val memory: String = "", val chats: List<AdvisorChat> = emptyList())

// One line of a project's .claude/backlog.md, from /api/advisors/backlog; mirrors BacklogItem in shared/advisors.ts.
@Serializable
data class BacklogItem(val rank: Int, val slug: String, val title: String, val why: String = "", val status: String, val spec: Boolean = false)

private fun rankPrompt(root: String) = "Read $root/.claude/backlog.md and the project's code and recent changes, then rank what to build next. Rewrite the backlog file (at most 10 lines) and reply with the top three."

// The newest .claude/audits/<date>.md, from /api/advisors/audit; mirrors Audit in shared/advisors.ts.
@Serializable
data class AuditFinding(val rank: Int, val screen: String, val problem: String, val severity: String, val fix: String)

@Serializable
data class AuditInfo(val date: String, val path: String, val findings: List<AuditFinding> = emptyList())

private fun auditPrompt(root: String) = "Audit the usability of the app in $root. If it has no running app, say so and write no file. Otherwise start it with the project's own start command, then walk each screen in headless Chrome on port 9334 (never 9333) at 390px wide, then at 1280px, and clean up the browser and the app when done. Write $root/.claude/audits/<YYYY-MM-DD>.md with today's date: at most 15 findings, ranked, one per line as `<rank>. <screen> | <problem in one line> | <severity high|med|low> | <fix in one line>`. Reply with the top three."

private fun specsFromAuditPrompt(root: String) = "Read the newest file in $root/.claude/audits and add its top findings to $root/.claude/backlog.md as `proposed` lines, with the audit line as the why. Keep the existing lines, reread the file before you edit it and renumber the ranks. Reply with the lines you added."

private fun moveUpPrompt(root: String, i: BacklogItem) = "In $root/.claude/backlog.md, move \"${i.title}\" (${i.slug}) up one rank and renumber the lines. Reread the file before you edit it."

// The facts in a memory file: its list lines.
private val FACT = Regex("""^\s*[-*] """)

fun memoryFacts(memory: String) = memory.lines().count { FACT.containsMatchIn(it) }

// Advisors (web/src/sessions/Advisors.tsx): PM, Architect and Designer, each with its current conversation, earlier ones and its memory.
@Composable
fun AdvisorsScreen(hub: Hub, onBack: () -> Unit, onOpen: () -> Unit) {
    val st by hub.store.state.collectAsState()
    val ws by hub.workspace.collectAsState()
    // Reloads after an advisor's turn, which may have changed its memory.
    val turns = st.live.filter { advisorOf(it.cwd) != null && !it.running }.joinToString { "${it.id}:${it.lastActive}" }
    val (load, reload) = rememberLoad { protocolJson.decodeFromString<List<AdvisorInfo>>(hub.read("/api/advisors")) }
    var loadedTurns by remember { mutableStateOf(turns) }
    LaunchedEffect(turns) { if (turns != loadedTurns) { loadedTurns = turns; reload() } }
    var memory by rememberSaveable { mutableStateOf<String?>(null) }
    var root by rememberSaveable { mutableStateOf<String?>(null) }
    val (backlog, reloadBacklog) = rememberLoad(root) { root?.let { protocolJson.decodeFromString<List<BacklogItem>>(hub.read("/api/advisors/backlog?root=${java.net.URLEncoder.encode(it, "UTF-8")}")) } }
    LaunchedEffect(turns) { reloadBacklog() }
    val (audits, reloadAudit) = rememberLoad(root) { root?.let { listOfNotNull(protocolJson.decodeFromString<AuditInfo?>(hub.read("/api/advisors/audit?root=${java.net.URLEncoder.encode(it, "UTF-8")}"))) } }
    LaunchedEffect(turns) { reloadAudit() }
    var auditOpen by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun go(open: suspend () -> Boolean) = scope.launch { if (open()) onOpen() }
    val info = load.data
    Column(Modifier.fillMaxSize()) {
        PageHeader("Advisors", onBack, actions = { IconBtn("refresh", "Refresh", reload) })
        PageBody {
            when {
                info == null && load.error.isNotEmpty() -> EmptyState("Could not load the advisors", load.error, icon = "organization")
                info == null -> Loading("Loading advisors")
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    for (a in ADVISORS) {
                        val c = st.live.firstOrNull { advisorOf(it.cwd)?.id == a.id }
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
                                lines = 1, metaLines = 1, selected = c != null && c.id == st.shownId,
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
                        if (a.id == "designer") {
                            SectionHeader("Usability audit", action = {
                                MoreButton("Project") { dismiss -> for (r in ws.repos) MenuItem(folderName(r.cwd), "repo", { dismiss(); root = r.cwd }, checked = r.cwd == root) }
                            })
                            val project = root
                            val list = audits.data
                            val audit = list?.firstOrNull()
                            val running = c?.running == true
                            val runAudit = { scope.launch { if (hub.openAdvisor("designer", false)) { hub.askChat(auditPrompt(project!!)); onOpen() } }; Unit }
                            when {
                                project == null -> Group { ListRow("Project", "Pick one in the menu to audit it", lines = 1) }
                                list == null -> Loading("Loading audit")
                                else -> Group {
                                    ListRow(
                                        "Audit", "${folderName(project)} · ${audit?.let { "${it.date} · ${it.findings.size} ${if (it.findings.size == 1) "finding" else "findings"}" } ?: "not run yet"}",
                                        lines = 1, metaLines = 1,
                                        state = {
                                            if (running) Badge("Running", BadgeTone.Running)
                                            else Button("Specs from audit", { scope.launch { if (hub.openAdvisor("pm", false)) { hub.askChat(specsFromAuditPrompt(project)); onOpen() } } }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm, enabled = audit != null && !hub.readOnly)
                                        },
                                        stateSlot = true,
                                        menu = { dismiss ->
                                            MenuItem("Open latest audit", "list-flat", { dismiss(); auditOpen = true }, enabled = audit != null)
                                            MenuItem("Run audit", "play", { dismiss(); runAudit() }, enabled = !running && !hub.readOnly)
                                        },
                                        onClick = if (running || hub.readOnly) null else ({ runAudit() }),
                                    )
                                }
                            }
                            if (auditOpen && audit != null) Sheet({ auditOpen = false }, "Audit, ${audit.date}", padded = false) {
                                for (f in audit.findings) ListRow(f.screen, "${f.severity} · ${f.problem}. ${f.fix}", leading = { Text(f.rank.toString(), style = Type.callout, color = av.fgMuted) }, lines = 1, metaLines = 2)
                            }
                        }
                        if (a.id == "pm") {
                            val items = backlog.data
                            SectionHeader("Backlog", items?.size?.takeIf { it > 0 }?.toString(), action = {
                                MoreButton("Project") { dismiss -> for (r in ws.repos) MenuItem(folderName(r.cwd), "repo", { dismiss(); root = r.cwd }, checked = r.cwd == root) }
                            })
                            val project = root
                            when {
                                project == null -> Group { ListRow("Project", "Pick one in the menu to see its backlog", lines = 1) }
                                items == null -> Loading("Loading backlog")
                                items.isEmpty() -> EmptyState("No backlog yet", "The PM ranks what to build next", "list-ordered", action = if (hub.readOnly) null else ({
                                    Button("Ask PM to rank", { scope.launch { if (hub.openAdvisor("pm", false)) { hub.askChat(rankPrompt(project)); onOpen() } } }, variant = ButtonVariant.Tinted, size = ButtonSize.Sm)
                                }))
                                else -> Group {
                                    items.forEachIndexed { n, i ->
                                        if (n > 0) Hairline()
                                        ListRow(
                                            i.title, "${i.status.replaceFirstChar { it.uppercase() }} · ${i.why}",
                                            leading = { Text(i.rank.toString(), style = Type.callout, color = av.fgMuted) },
                                            lines = 1, metaLines = 1,
                                            menu = if (hub.readOnly) null else ({ dismiss ->
                                                if (i.status == "proposed" || i.status == "specced") MenuItem("Build", "play", {
                                                    dismiss()
                                                    hub.newChat(project, text = if (i.spec) buildSpecPrompt(".claude/specs/${i.slug}.md") else buildItemPrompt(i.title, i.why, i.slug), onOpened = onOpen)
                                                })
                                                MenuItem("Ask PM to move up", "arrow-up", { dismiss(); scope.launch { if (hub.openAdvisor("pm", false)) { hub.askChat(moveUpPrompt(project, i)); onOpen() } } }, enabled = i.rank > 1)
                                            }),
                                        )
                                    }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.padding(bottom = Tokens.sp16))
                }
            }
        }
    }
}

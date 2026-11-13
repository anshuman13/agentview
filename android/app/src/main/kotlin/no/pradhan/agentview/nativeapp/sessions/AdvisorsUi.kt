package no.pradhan.agentview.nativeapp.sessions

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.read
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
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.workspace.PageBody
import no.pradhan.agentview.nativeapp.workspace.rememberLoad

// What the Advisors page shows of each, from /api/advisors.
@Serializable
data class AdvisorChat(val sessionId: String, val title: String = "", val lastModified: Long = 0)

@Serializable
data class AdvisorInfo(val id: String, val memory: String = "", val chats: List<AdvisorChat> = emptyList())

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
                    }
                    Spacer(Modifier.padding(bottom = Tokens.sp16))
                }
            }
        }
    }
}

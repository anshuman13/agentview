package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.delay

// Source Control (web/src/workspace/Changes.tsx): branch, commit box, staged and unstaged files, a file opens as its diff.
@Composable
fun ChangesScreen(hub: Hub, onBack: () -> Unit) {
    val st by hub.store.state.collectAsState()
    val chat = st.shownId
    var open by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    val o = open
    if (o != null) { FileScreen(hub, o, onBack = { open = null }); return }
    val (load, reload) = rememberLoad(chat) { parseGitStatus(hub.read("/api/git/status")) }
    LaunchedEffect(chat) { while (true) { delay(5000); reload() } }
    var message by rememberSaveable(chat) { mutableStateOf("") }
    var ask by androidx.compose.runtime.remember { mutableStateOf<List<GitFile>?>(null) }
    val status = load.data
    val files = status?.files ?: emptyList()
    val staged = files.filter { it.staged }
    val changes = files.filter { !it.staged }
    fun run(action: String, body: String, done: () -> Unit = {}) = hub.write("/api/git/$action", body, "Could not $action") { if (it) done(); reload() }

    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Source Control", onBack) { IconBtn(Icons.Filled.Refresh, "Refresh", reload) }
        PageBody {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Group(Modifier.padding(top = Tokens.sp4)) {
                        val ab = listOfNotNull(status?.behind?.takeIf { it > 0 }?.let { "$it behind" }, status?.ahead?.takeIf { it > 0 }?.let { "$it ahead" }).joinToString(" · ")
                        ListRow(status?.branch?.ifEmpty { null } ?: if (status == null) "Loading" else "No branch", ab.ifEmpty { null }, lines = 1)
                    }
                }
                item {
                    Column(Modifier.padding(horizontal = Tokens.sp6, vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                        TextField(message, { message = it }, placeholder = "Message${status?.branch?.let { " (commit on $it)" } ?: ""}", minLines = 1, maxLines = 6)
                        Button("Commit", { run("commit", commitBody(message)) { message = "" } }, variant = ButtonVariant.Filled, enabled = staged.isNotEmpty() && message.isNotBlank(), fill = true)
                    }
                }
                item { ErrorHint(load.error) }
                if (staged.isNotEmpty()) {
                    item {
                        SectionHeader("Staged Changes", staged.size.toString(), action = {
                            MoreButton { close -> MenuItem("Unstage All Changes", { close(); run("unstage", pathsBody(staged)) }) }
                        })
                    }
                    item { FileGroup(staged, onOpen = { open = it.path }) { f, close -> MenuItem("Unstage Changes", { close(); run("unstage", pathsBody(listOf(f))) }) } }
                }
                if (changes.isNotEmpty()) {
                    item {
                        SectionHeader("Changes", changes.size.toString(), action = {
                            MoreButton { close ->
                                MenuItem("Stage All Changes", { close(); run("stage", pathsBody(changes)) })
                                MenuItem("Discard All Changes", { close(); ask = changes }, danger = true)
                            }
                        })
                    }
                    item {
                        FileGroup(changes, onOpen = { open = it.path }) { f, close ->
                            MenuItem("Stage Changes", { close(); run("stage", pathsBody(listOf(f))) })
                            MenuItem("Discard Changes", { close(); ask = listOf(f) }, danger = true)
                        }
                    }
                }
                if (status != null && files.isEmpty()) item { EmptyState("No changes") }
                item { Spacer(Modifier.padding(bottom = Tokens.sp16)) }
            }
        }
    }
    ask?.let { list ->
        ConfirmDialog(discardTitle(list), discardDetail(list), if (list.any { it.status == "?" }) "Discard and Delete" else "Discard", { run("discard", pathsBody(list)) }, onDismiss = { ask = null })
    }
}

@Composable
private fun letterColor(letter: String): Color = when (letter) {
    "A", "U" -> av.ok
    "D" -> av.err
    else -> av.modified
}

@Composable
private fun FileGroup(files: List<GitFile>, onOpen: (GitFile) -> Unit, menu: @Composable androidx.compose.foundation.layout.ColumnScope.(GitFile, () -> Unit) -> Unit) {
    Group {
        files.forEachIndexed { i, f ->
            if (i > 0) Hairline(lead = true)
            val name = f.path.substringAfterLast('/')
            val letter = letterOf(f)
            ListRow(
                name, parentOf(f.path).ifEmpty { null }, lines = 1, strike = f.status == "D",
                leading = { FileTag(name) },
                trailing = {
                    RowLabel(letter, letterColor(letter))
                    MoreButton { close ->
                        MenuItem("Open File", { close(); onOpen(f) })
                        menu(f, close)
                    }
                },
                onClick = { onOpen(f) },
            )
        }
    }
}

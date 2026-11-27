package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.Undoable
import no.pradhan.agentview.nativeapp.app.claimRoute
import no.pradhan.agentview.nativeapp.codex.wiki.MEMORY
import no.pradhan.agentview.nativeapp.codex.wiki.PREFERENCES
import no.pradhan.agentview.nativeapp.codex.wiki.PREFERENCE_CHARS
import no.pradhan.agentview.nativeapp.codex.wiki.givenPreferences
import no.pradhan.agentview.nativeapp.sessions.since
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.app.memoryFiles
import no.pradhan.agentview.nativeapp.app.forgetMemory
import no.pradhan.agentview.nativeapp.app.read
import no.pradhan.agentview.nativeapp.app.readFile
import no.pradhan.agentview.nativeapp.app.saveFile
import no.pradhan.agentview.nativeapp.app.saveMemory
import no.pradhan.agentview.nativeapp.sessions.segmentOf
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.Markdown
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextDialog
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.rememberLoad

@Serializable
data class MemoryFile(val path: String, val name: String, val description: String = "", val text: String = "", val editable: Boolean = false, val at: Long = 0)

// Where a memory file comes from: the repo, or the account folder (.claude, .claude-alt, .codex) it was read from.
fun memoryWhere(f: MemoryFile, cwd: String): String {
    if (f.path.substringBeforeLast('/') == cwd) return "Repo instructions"
    val account = f.path.split('/').lastOrNull { it.startsWith(".claude") || it == ".codex" } ?: ""
    return if (f.path.contains("/memory/")) "Memory · $account" else "Global instructions · $account"
}

// The repo CLAUDE.md with one more bullet; null when the rule is empty. Same as shared/steering.ts.
fun appendRule(text: String, rule: String): String? {
    val line = rule.trim().replace(Regex("\\s+"), " ")
    if (line.isEmpty()) return null
    val head = if (text.isNotEmpty() && !text.endsWith("\n")) "$text\n" else text
    return "$head- $line\n"
}

// Rules go to the first instruction file, the repo's, as a path in the folder; web Memory.tsx ruleFile says the same.
fun ruleFile(cwd: String, files: List<String>): String = files.firstOrNull()?.takeIf { it.startsWith("$cwd/") }?.removePrefix("$cwd/") ?: "CLAUDE.md"

private const val RULE_FAILED = "Could not save the rule. Your text is still here."

@Composable
private fun AddRule(hub: Hub, file: String, onSaved: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val save = { before: String ->
        appendRule(before, text)?.let { next ->
            hub.saveFile(file, next, RULE_FAILED) {
                if (it) {
                    text = ""
                    hub.undoable.tryEmit(Undoable("Rule added") { hub.saveFile(file, before, "Could not undo the rule") { onSaved() } })
                    onSaved()
                }
            }
        }
    }
    val add = {
        if (appendRule("", text) != null) scope.launch {
            runCatching { hub.readFile(file).content }.onSuccess { save(it) }.onFailure { hub.notice.value = RULE_FAILED }
        }
    }
    TextField(text, { text = it }, Modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp2), singleLine = true, placeholder = "Add a rule",
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }))
}

// The mark as a row's state Badge: Conflicts in the waiting tone, the others quiet.
@Composable
private fun MarkBadge(m: MemoryMark) = Badge(m.mark, if (m.mark == "Conflicts") BadgeTone.Waiting else BadgeTone.Quiet)

// What the agent is told and remembers in this folder, like Windsurf's memories panel. The repo instruction file and Claude's memory files can be changed.
// `initial` opens that file once the list has loaded.
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MemorySheet(hub: Hub, cwd: String, instructionFiles: List<String>, initial: String? = null, onDismiss: () -> Unit) {
    val file = ruleFile(cwd, instructionFiles)
    val (files, reload) = rememberLoad(cwd) { hub.memoryFiles() }
    var open by remember { mutableStateOf<MemoryFile?>(null) }
    var opened by remember { mutableStateOf(initial == null) }
    val facts by hub.codex.state.select { it.facts }
    val listScroll = rememberScrollState()
    val now = System.currentTimeMillis()
    val markOf = { f: MemoryFile -> memoryMark(f, facts, segmentOf(cwd), now) }
    LaunchedEffect(files.data) {
        val list = files.data ?: return@LaunchedEffect
        if (!opened) { opened = true; open = list.firstOrNull { it.path == initial } }
    }
    open?.let { f ->
        var draft by remember(f) { mutableStateOf<String?>(null) }
        var saving by remember(f) { mutableStateOf(false) }
        var discard by remember(f) { mutableStateOf(false) }
        val back: () -> Unit = { if (draft != null) discard = true else open = null }
        if (discard) ConfirmDialog("Discard the edit?", "Your changes to ${f.name} are not saved.", "Discard", { open = null }, onDismiss = { discard = false })
        Sheet(onDismiss = onDismiss, title = f.name, onBack = back, action = { Button("Back", back, variant = ButtonVariant.Plain, size = ButtonSize.Sm) }) {
            Text(memoryWhere(f, cwd), style = Type.footnote, color = av.fgMuted)
            markOf(f)?.let { Text(markLine(it, f.at, now), style = Type.footnote, color = av.fgMuted) }
            val text = draft
            if (text != null) {
                TextField(text, { draft = it }, minLines = 6)
                Row(Modifier.padding(top = Tokens.sp3), horizontalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
                    val saveMemoryBody = {
                        saving = true
                        hub.saveMemory(f.path, text, "Could not save the memory. Your text is still here.") { previous ->
                            saving = false
                            if (previous != null) {
                                open = f.copy(text = text)
                                reload()
                                hub.undoable.tryEmit(Undoable("Memory updated") {
                                    hub.saveMemory(f.path, previous, "Could not undo the memory update") { if (it != null) { if (open?.path == f.path) open = f.copy(text = previous); reload() } }
                                })
                            }
                        }
                    }
                    val saveRule = { hub.saveFile(file, text) { if (it) { open = f.copy(text = text); reload() } } }
                    Button("Save", if (f.editable) saveMemoryBody else saveRule, enabled = if (f.editable) text.isNotBlank() && !saving else true, size = ButtonSize.Sm)
                    Button("Cancel", { draft = null }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                }
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp3), verticalArrangement = Arrangement.spacedBy(Tokens.sp3)) {
                    if ((f.path == "$cwd/$file" || f.editable) && !hub.readOnly) Button("Edit", { draft = f.text }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, icon = "edit")
                    if (f.editable && !hub.readOnly && !isMemoryIndex(f.path)) {
                        val leave = { gone: Boolean ->
                            saving = false
                            if (gone) { open = null; reload() }
                        }
                        Button("Forget", { saving = true; hub.forgetMemory(f, reload, leave) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm, icon = "trash", enabled = !saving)
                    }
                }
                Markdown(f.text.ifBlank { "Empty" })
            }
        }
        return
    }
    Sheet(onDismiss = onDismiss, title = "Memory", padded = false, full = false, scroll = listScroll) {
        val list = files.data
        when {
            list == null && files.busy -> Loading("Loading the memory…")
            files.error.isNotEmpty() && list.isNullOrEmpty() -> EmptyState("Could not load memory", files.error, action = { Button("Retry", reload, size = ButtonSize.Sm) })
            list.isNullOrEmpty() -> EmptyState("No $file or memory files", "Add a rule below to create one")
            else -> list.forEach { f ->
                val mark = markOf(f)
                ListRow(f.name, listOf(f.description, memoryWhere(f, cwd), if (f.at > 0) since(f.at, now) else "").filter { it.isNotEmpty() }.joinToString(" · "), lines = 2, state = mark?.let { { MarkBadge(it) } }, stateSlot = true, trailing = { AvIcon("chevron-right", tint = av.fgMuted) }, onClick = { open = f })
            }
        }
        if (list != null && !hub.readOnly) AddRule(hub, file, reload)
        // The wiki's Memory claims that new chats in this profile start with; web Memory.tsx GivenClaims shows the same.
        val given = givenPreferences(facts, segmentOf(cwd), now)
        SectionHeader("From the wiki", given.size.takeIf { it > 0 }?.toString())
        Text("New chats get these", Modifier.padding(horizontal = Tokens.listPad), style = Type.footnote, color = av.fgMuted)
        if (given.isEmpty()) EmptyState("Nothing from the wiki yet", "Memory claims on the wiki are given to every new chat in this profile")
        else given.forEach { f ->
            val openClaim = {
                hub.link.value = DeepLink(codexRoute = claimRoute(f))
                onDismiss()
            }
            ListRow(f.str("text") ?: "", f.long("at")?.let { since(it, now) }, leading = { AvIcon("lightbulb", tint = av.fgMuted) }, onClick = openClaim, menu = { dismiss ->
                MenuItem("Open in wiki", "book", { dismiss(); openClaim() })
                if (!hub.readOnly) MenuItem("Retire", "archive", {
                    dismiss()
                    if (hub.codex.update(f, mapOf("state" to "retired"))) hub.undoable.tryEmit(Undoable("Claim retired") { hub.codex.update(f, mapOf("state" to null)) })
                }, danger = true)
            })
        }
        val left = leftOutPreferences(facts, segmentOf(cwd), now)
        if (left > 0) {
            Text("$left more not given: new chats get the $PREFERENCES newest, up to $PREFERENCE_CHARS characters", Modifier.padding(horizontal = Tokens.listPad), style = Type.footnote, color = av.fgMuted)
            Button("Open Memory", {
                hub.link.value = DeepLink(codexRoute = "wiki:$MEMORY")
                onDismiss()
            }, Modifier.padding(horizontal = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
        }
    }
}

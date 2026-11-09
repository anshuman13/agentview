package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive


@Composable
fun PendingList(pending: List<Pending>, mode: String, hub: Hub) {
    if (pending.isEmpty()) return
    Column(Modifier.heightIn(max = Tokens.scrollMax).verticalScroll(rememberScrollState()).padding(horizontal = Tokens.sp4, vertical = Tokens.sp2), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        for (p in pending) when {
            p is Pending.Question -> QuestionCard(p, hub)
            p is Pending.Permission && p.toolName == "ExitPlanMode" -> PlanCard(p, mode, hub)
            p is Pending.Permission -> PermissionCard(p, mode, hub)
        }
    }
}

@Composable
private fun Title(text: String) = Text(text, style = Type.headline, color = av.fg)

@Composable
private fun Desc(text: String) = Text(text, style = Type.subheadline, color = av.fgMuted)

@Composable
private fun Hint(mode: String) {
    MODE_HINTS[mode]?.let { Text(it, style = Type.footnote, color = av.fgMuted) }
}

@Composable
private fun Primary(text: String, onClick: () -> Unit) {
    Button(text, onClick, variant = ButtonVariant.Filled, size = ButtonSize.Lg, fill = true)
}

@Composable
private fun Secondary(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(text, onClick, variant = ButtonVariant.Gray, size = ButtonSize.Lg, enabled = enabled, fill = true)
}

@Composable
fun PermissionCard(p: Pending.Permission, mode: String, hub: Hub) {
    Panel {
        Title(p.title)
        PermissionBody(p)
        if (p.detail.isNotEmpty()) Desc(p.detail)
        Decision(p, mode, hub, "Allow", "Deny")
    }
}

private const val QUOTE_MAX = 80

// Port of web/src/chat/Pending.tsx planParagraphs: the plan's blocks split at blank lines, leaving fenced code whole.
fun planParagraphs(plan: String): List<String> {
    val out = mutableListOf<String>()
    var cur = mutableListOf<String>()
    var fence = false
    for (line in plan.lines()) {
        if (line.trimStart().let { it.startsWith("```") || it.startsWith("~~~") }) fence = !fence
        if (!fence && line.isBlank()) {
            if (cur.isNotEmpty()) out += cur.joinToString("\n")
            cur = mutableListOf()
        } else cur += line
    }
    if (cur.isNotEmpty()) out += cur.joinToString("\n")
    return out
}

private fun planQuote(paragraph: String): String {
    val flat = paragraph.replace(Regex("\\s+"), " ").trim()
    return "> " + if (flat.length > QUOTE_MAX) flat.take(QUOTE_MAX).trimEnd() + "…" else flat
}

// Port of planFeedback: one message quoting each commented paragraph, then the comment; empty when there are none.
fun planFeedback(paragraphs: List<String>, notes: Map<Int, String>): String {
    val parts = paragraphs.mapIndexedNotNull { i, p -> notes[i]?.trim()?.takeIf { it.isNotEmpty() }?.let { "${planQuote(p)}\n$it" } }
    return if (parts.isEmpty()) "" else "Comments on the plan:\n\n" + parts.joinToString("\n\n")
}

@Composable
private fun PlanCard(p: Pending.Permission, mode: String, hub: Hub) {
    val paragraphs = remember(p.input) { planParagraphs(p.input.s("plan")) }
    var notes by remember(p.id) { mutableStateOf(emptyMap<Int, String>()) }
    var editing by remember(p.id) { mutableStateOf<Int?>(null) }
    Panel {
        Title(p.title)
        if (paragraphs.isNotEmpty()) Column(Modifier.heightIn(max = Tokens.scrollTall).well(av).verticalScroll(rememberScrollState()).padding(Tokens.sp5), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            paragraphs.forEachIndexed { i, text ->
                Column(Modifier.fillMaxWidth().clickable { editing = i }) {
                    Markdown(text)
                    notes[i]?.takeIf { it.isNotEmpty() }?.let { Text(it, Modifier.padding(start = Tokens.sp4, top = Tokens.sp2), style = Type.subheadline, color = av.accent) }
                }
            }
        }
        if (p.detail.isNotEmpty()) Desc(p.detail)
        Decision(p, mode, hub, "Approve", "Keep planning") {
            val text = planFeedback(paragraphs, notes)
            if (text.isEmpty()) hub.permission(p.id, false) else hub.submit(text, true) {}
        }
    }
    editing?.let { i ->
        CommentSheet("Comment on the plan", planQuote(paragraphs[i]), onSend = { t -> notes = notes + (i to t.trim()) }, onDismiss = { editing = null }, initial = notes[i] ?: "", sendLabel = "Add comment")
    }
}

@Composable
private fun Decision(p: Pending.Permission, mode: String, hub: Hub, yes: String, no: String, onNo: (() -> Unit)? = null) {
    val always = p.canAlwaysAllow && p.toolName != "ExitPlanMode"
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        Primary(yes) { hub.permission(p.id, true) }
        if (always) Secondary("Always allow") { hub.permission(p.id, true, true) }
        Secondary(no) { if (onNo != null) onNo() else hub.permission(p.id, false) }
    }
    Hint(mode)
}

@Composable
private fun PermissionBody(p: Pending.Permission) {
    val input = p.input
    when (p.toolName) {
        "Bash" -> {
            val d = input.s("description")
            if (d.isNotEmpty() && d != p.title) Desc(d)
            CodeBlock(input.s("command"), modifier = Modifier.heightIn(max = Tokens.scrollMid))
        }
        "Edit", "Write", "MultiEdit" -> {
            val edits = when (p.toolName) {
                "Write" -> listOf("" to input.s("content"))
                "Edit" -> listOf(input.s("old_string") to input.s("new_string"))
                else -> (input["edits"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let { e -> e.s("old_string") to e.s("new_string") } } ?: emptyList()
            }
            Text(input.s("file_path"), style = Mono, color = av.fg)
            edits.forEach { (a, b) -> DiffView(lineDiff(a, b)) }
        }
        "WebFetch" -> {
            Text(input.s("url"), style = Mono, color = av.fg)
            input.s("prompt").takeIf { it.isNotEmpty() }?.let { Desc(it) }
        }
        "WebSearch" -> Text(input.s("query"), style = Mono, color = av.fg)
        else -> {
            val rows = input.entries.map { (k, v) -> k to (if (v is JsonPrimitive && v.isString) v.content else v.toString()) }.filter { it.second.isNotEmpty() }
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) { rows.forEach { (k, v) -> KeyValue(k, v) } }
        }
    }
}

@Composable
private fun KeyValue(k: String, v: String) {
    var open by rememberSaveable(k, v) { mutableStateOf(false) }
    val long = v.length > 160 || v.lines().size > 3
    Column {
        Text(k, style = Mono, color = av.fgMuted)
        Text(v, style = Type.subheadline, color = av.fg, maxLines = if (long && !open) 3 else Int.MAX_VALUE)
        if (long) Button(if (open) "Show less" else "Show more", { open = !open }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    }
}

@Composable
fun DiffView(lines: List<DiffLine>, modifier: Modifier = Modifier) {
    val shown = lines.take(MAX_DIFF_LINES)
    val scroll = rememberScrollState()
    Column(modifier.heightIn(max = Tokens.scrollMid).well(av).verticalScroll(rememberScrollState()).padding(vertical = Tokens.sp2)) {
        for (l in shown) DiffCodeLine(l, Lang.Plain, wrap = false, scroll = scroll, gutter = Tokens.sp8)
        if (lines.size > MAX_DIFF_LINES) Text("${lines.size - MAX_DIFF_LINES} more lines", style = Type.footnote, color = av.fgMuted, modifier = Modifier.padding(horizontal = Tokens.sp5))
    }
}

@Composable
private fun QuestionCard(q: Pending.Question, hub: Hub) {
    var step by remember(q.id) { mutableStateOf(0) }
    var answers by remember(q.id) { mutableStateOf(emptyMap<String, String>()) }
    var picked by remember(q.id) { mutableStateOf(emptyList<String>()) }
    var other by remember(q.id) { mutableStateOf<String?>(null) }
    val qq = q.questions.getOrNull(step) ?: return
    val total = q.questions.size
    val multi = qq.multiSelect
    fun go(to: Int) { step = to; picked = emptyList(); other = null }
    fun answer(value: String) {
        val next = answers + (qq.question to value)
        if (step + 1 >= total) hub.answer(q.id, next) else { answers = next; go(step + 1) }
    }
    fun pick(label: String) {
        if (!multi) answer(label) else picked = if (label in picked) picked - label else picked + label
    }
    val result = (picked + listOfNotNull(other?.trim())).filter { it.isNotEmpty() }.joinToString(", ")
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(qq.header.ifEmpty { "Question" }, style = Type.label, color = av.fgMuted, modifier = Modifier.weight(1f))
            if (total > 1) Text("${step + 1} of $total", style = Type.label, color = av.fgMuted)
        }
        Text(qq.question, style = Type.body, color = av.fg)
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            for (o in qq.options) OptionRow(multi, o.label in picked || answers[qq.question] == o.label, o.label, o.description, o.preview) { pick(o.label) }
            val text = other
            if (text == null) OptionRow(multi, false, "Other…", "", null, muted = true) { other = "" }
            else TextField(
                value = text,
                onValueChange = { other = it },
                placeholder = "Type your answer",
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (result.isNotEmpty()) answer(result) }),
            )
        }
        if (step > 0 || multi || other != null) {
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                if (multi || other != null) Secondary(if (step + 1 < total) "Next" else "Done", enabled = result.isNotEmpty()) { answer(result) }
                if (step > 0) Secondary("Back") { go(step - 1) }
            }
        }
    }
}

@Composable
private fun OptionRow(multi: Boolean, on: Boolean, label: String, description: String, preview: String?, muted: Boolean = false, onPick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clickable(onClick = onPick).padding(vertical = Tokens.sp4, horizontal = Tokens.sp2), horizontalArrangement = Arrangement.spacedBy(Tokens.sp5)) {
        if (multi) Text(if (on) "[x]" else "[ ]", style = Mono, color = if (on) av.fg else av.fgMuted)
        else Box(Modifier.padding(top = Tokens.sp1).size(Tokens.iconSm).border(BorderStroke(Tokens.hairline, if (on) av.accent else av.fgMuted), CircleShape).padding(Tokens.sp1).background(if (on) av.accent else Color.Transparent, CircleShape))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tokens.sp1)) {
            Text(label, style = Type.body, color = if (muted) av.fgMuted else av.fg)
            if (description.isNotEmpty()) Desc(description)
            if (preview != null) CodeBlock(preview, modifier = Modifier.heightIn(max = Tokens.scrollShort))
        }
    }
}

@Composable
fun BlockedCard(ev: ChatEvent, hub: Hub) {
    val rule = if (ev.rule.startsWith("Bash(")) ev.rule.removePrefix("Bash(").removeSuffix(")").replace(Regex("\\\\([\\\\()])"), "$1") else ev.rule
    Panel {
        Title("Auto mode blocked this")
        CodeBlock(rule, modifier = Modifier.heightIn(max = Tokens.scrollShort))
        if (ev.reason.isNotEmpty()) Desc(ev.reason)
        if (ev.allowed) Text("Allowed for this chat", style = Type.footnote, color = av.fgMuted)
        else Primary("Allow and retry") { hub.allowBlocked(ev.id) }
    }
}

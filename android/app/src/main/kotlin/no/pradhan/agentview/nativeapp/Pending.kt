package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private val card = RoundedCornerShape(8.dp)

@Composable
private fun PdCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().background(av.raised, card).border(BorderStroke(1.dp, av.border), card).padding(Sp.s7),
        verticalArrangement = Arrangement.spacedBy(Sp.s6),
    ) { content() }
}

@Composable
fun PendingList(pending: List<Pending>, mode: String, hub: Hub) {
    if (pending.isEmpty()) return
    Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()).padding(horizontal = Sp.s4, vertical = Sp.s2), verticalArrangement = Arrangement.spacedBy(Sp.s4)) {
        for (p in pending) when {
            p is Pending.Question -> QuestionCard(p, hub)
            p is Pending.Permission && p.toolName == "ExitPlanMode" -> PlanCard(p, mode, hub)
            p is Pending.Permission -> PermissionCard(p, mode, hub)
        }
    }
}

@Composable
private fun Title(text: String) = Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)

@Composable
private fun Desc(text: String) = Text(text, style = MaterialTheme.typography.labelMedium, color = av.fgMuted)

@Composable
private fun Hint(mode: String) {
    MODE_HINTS[mode]?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = av.fgFaint) }
}

@Composable
private fun Primary(text: String, onClick: () -> Unit) {
    Button(onClick, Modifier.fillMaxWidth().heightIn(min = Sp.touch), colors = ButtonDefaults.buttonColors(containerColor = av.accent, contentColor = Color.White)) { Text(text) }
}

@Composable
private fun Secondary(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(onClick, Modifier.fillMaxWidth().heightIn(min = Sp.touch), enabled = enabled, border = BorderStroke(1.dp, av.border)) { Text(text, color = av.fg) }
}

@Composable
fun PermissionCard(p: Pending.Permission, mode: String, hub: Hub) {
    PdCard {
        Title(p.title)
        PermissionBody(p)
        if (p.detail.isNotEmpty()) Desc(p.detail)
        Decision(p, mode, hub, "Allow", "Deny")
    }
}

@Composable
private fun PlanCard(p: Pending.Permission, mode: String, hub: Hub) {
    PdCard {
        Title(p.title)
        val plan = p.input.s("plan")
        if (plan.isNotEmpty()) Box(Modifier.fillMaxWidth().heightIn(max = 320.dp).background(av.surface, RoundedCornerShape(4.dp)).verticalScroll(rememberScrollState()).padding(Sp.s5)) { Markdown(plan) }
        if (p.detail.isNotEmpty()) Desc(p.detail)
        Decision(p, mode, hub, "Approve", "Keep planning")
    }
}

@Composable
private fun Decision(p: Pending.Permission, mode: String, hub: Hub, yes: String, no: String) {
    val always = p.canAlwaysAllow && p.toolName != "ExitPlanMode"
    Column(verticalArrangement = Arrangement.spacedBy(Sp.s4)) {
        Primary(yes) { hub.permission(p.id, true) }
        if (always) Secondary("Always allow") { hub.permission(p.id, true, true) }
        Secondary(no) { hub.permission(p.id, false) }
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
            CodeBlock(input.s("command"), modifier = Modifier.heightIn(max = 240.dp))
        }
        "Edit", "Write", "MultiEdit" -> {
            val edits = when (p.toolName) {
                "Write" -> listOf("" to input.s("content"))
                "Edit" -> listOf(input.s("old_string") to input.s("new_string"))
                else -> (input["edits"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let { e -> e.s("old_string") to e.s("new_string") } } ?: emptyList()
            }
            Text(input.s("file_path"), fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = av.fg)
            edits.forEach { (a, b) -> DiffView(lineDiff(a, b)) }
        }
        "WebFetch" -> {
            Text(input.s("url"), fontFamily = FontFamily.Monospace, fontSize = 12.sp)
            input.s("prompt").takeIf { it.isNotEmpty() }?.let { Desc(it) }
        }
        "WebSearch" -> Text(input.s("query"), fontFamily = FontFamily.Monospace, fontSize = 12.sp)
        else -> {
            val rows = input.entries.map { (k, v) -> k to (if (v is JsonPrimitive && v.isString) v.content else v.toString()) }.filter { it.second.isNotEmpty() }
            Column(verticalArrangement = Arrangement.spacedBy(Sp.s2)) { rows.forEach { (k, v) -> KeyValue(k, v) } }
        }
    }
}

@Composable
private fun KeyValue(k: String, v: String) {
    var open by rememberSaveable(k, v) { mutableStateOf(false) }
    val long = v.length > 160 || v.lines().size > 3
    Column {
        Text(k, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = av.fgFaint)
        Text(v, style = MaterialTheme.typography.labelMedium, maxLines = if (long && !open) 3 else Int.MAX_VALUE)
        if (long) Text(if (open) "Show less" else "Show more", style = MaterialTheme.typography.labelSmall, color = av.fgMuted, modifier = Modifier.clickable { open = !open })
    }
}

@Composable
fun DiffView(lines: List<DiffLine>, modifier: Modifier = Modifier) {
    val shown = lines.take(MAX_DIFF_LINES)
    Column(modifier.fillMaxWidth().heightIn(max = 240.dp).background(av.surface, RoundedCornerShape(4.dp)).border(BorderStroke(1.dp, av.border), RoundedCornerShape(4.dp)).verticalScroll(rememberScrollState())) {
        Column(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = Sp.s2)) {
            for (l in shown) {
                val bg = when (l.mark) { '+' -> av.ok.copy(alpha = 0.14f); '-' -> av.err.copy(alpha = 0.14f); else -> Color.Transparent }
                Text("${l.mark} ${l.text}", fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp, softWrap = false, modifier = Modifier.background(bg).padding(horizontal = Sp.s5))
            }
            if (lines.size > MAX_DIFF_LINES) Text("${lines.size - MAX_DIFF_LINES} more lines", fontSize = 12.sp, color = av.fgFaint, modifier = Modifier.padding(horizontal = Sp.s5))
        }
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
    PdCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(qq.header.ifEmpty { "Question" }, style = MaterialTheme.typography.labelSmall, color = av.fgFaint, modifier = Modifier.weight(1f))
            if (total > 1) Text("${step + 1} of $total", style = MaterialTheme.typography.labelSmall, color = av.fgFaint)
        }
        Text(qq.question, style = MaterialTheme.typography.bodyMedium)
        Column(verticalArrangement = Arrangement.spacedBy(Sp.s2)) {
            for (o in qq.options) OptionRow(multi, o.label in picked || answers[qq.question] == o.label, o.label, o.description, o.preview) { pick(o.label) }
            val text = other
            if (text == null) OptionRow(multi, false, "Other…", "", null, muted = true) { other = "" }
            else OutlinedTextField(
                value = text,
                onValueChange = { other = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Type your answer") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (result.isNotEmpty()) answer(result) }),
            )
        }
        if (step > 0 || multi || other != null) {
            Column(verticalArrangement = Arrangement.spacedBy(Sp.s4)) {
                if (multi || other != null) Secondary(if (step + 1 < total) "Next" else "Done", enabled = result.isNotEmpty()) { answer(result) }
                if (step > 0) Secondary("Back") { go(step - 1) }
            }
        }
    }
}

@Composable
private fun OptionRow(multi: Boolean, on: Boolean, label: String, description: String, preview: String?, muted: Boolean = false, onPick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = Sp.touch).clickable(onClick = onPick).padding(vertical = Sp.s4, horizontal = Sp.s2), horizontalArrangement = Arrangement.spacedBy(Sp.s5)) {
        if (multi) Text(if (on) "[x]" else "[ ]", fontFamily = FontFamily.Monospace, color = if (on) av.fg else av.fgMuted)
        else Box(Modifier.padding(top = 3.dp).size(14.dp).border(BorderStroke(1.dp, if (on) av.fg else av.fgMuted), CircleShape).padding(3.dp).background(if (on) av.fg else Color.Transparent, CircleShape))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Sp.s1)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = if (muted) av.fgMuted else av.fg)
            if (description.isNotEmpty()) Desc(description)
            if (preview != null) CodeBlock(preview, modifier = Modifier.heightIn(max = 160.dp))
        }
    }
}

@Composable
fun BlockedCard(ev: ChatEvent, hub: Hub) {
    val rule = if (ev.rule.startsWith("Bash(")) ev.rule.removePrefix("Bash(").removeSuffix(")").replace(Regex("\\\\([\\\\()])"), "$1") else ev.rule
    PdCard {
        Title("Auto mode blocked this")
        CodeBlock(rule, modifier = Modifier.heightIn(max = 160.dp))
        if (ev.reason.isNotEmpty()) Desc(ev.reason)
        if (ev.allowed) Text("Allowed for this chat", style = MaterialTheme.typography.labelSmall, color = av.fgFaint)
        else Primary("Allow and retry") { hub.allowBlocked(ev.id) }
    }
}

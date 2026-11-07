package no.pradhan.agentview.nativeapp

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle

// The Codex task row: check circle, meta line, swipes and the long-press menu.

@Composable
fun CheckCircle(done: Boolean, label: String, onClick: () -> Unit) {
    Box(Modifier.size(Tokens.touch).clip(CircleShape).clickable(onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(Modifier.size(Tokens.sizeRow).clip(CircleShape).then(if (done) Modifier.background(av.ok) else Modifier.border(Geometry.stroke, av.fgFaint, CircleShape)), contentAlignment = Alignment.Center) {
            if (done) Icon(Icons.Filled.Check, null, Modifier.size(Tokens.iconSm), tint = av.onColor)
        }
    }
}

fun profileLabel(p: String) = if (p == WORK) "Work" else "Personal"
fun priorityLabel(p: Int) = when (p) { 3 -> "High"; 2 -> "Medium"; 1 -> "Low"; else -> "None" }

// The meta line of a task: due text (red when late), then repeat, checklist or priority, tags and the profile.
@Composable
fun taskMeta(row: Row, now: Long, inDay: Boolean, showProfile: Boolean): androidx.compose.ui.text.AnnotatedString {
    val due = dueText(row, now, inDay)
    val at = row.at
    val done = row.status == "done"
    val checks = Regex("^\\s*[-*] \\[([ xX])\\]", RegexOption.MULTILINE).findAll(row.text ?: "").toList()
    val extra = when {
        isRepeat(row.text) -> "Repeats"
        checks.isNotEmpty() -> "${checks.count { it.groupValues[1].lowercase() == "x" }}/${checks.size}"
        !done && row.priority == 3 -> "High"
        !done && row.priority == 2 -> "Medium"
        else -> null
    }
    val tags = tagList(row.tags).joinToString(" ") { "#$it" }
    val preview = if (row.status == "note" && !isRepeat(row.text)) firstLine(row.text) else ""
    val bits = listOfNotNull(extra, tags.ifEmpty { null }, if (showProfile) profileLabel(row.profile) else null)
    return buildAnnotatedString {
        if (due != null) withStyle(SpanStyle(color = if (at != null && at < now) av.err else if (daysFrom(at ?: now, now) == 0L) av.accentText else av.fgMuted)) { append(due) }
        if (due != null && bits.isNotEmpty()) append(" · ")
        append(bits.joinToString(" · "))
        if (due == null && bits.isEmpty()) append(preview)
    }
}

// An open task: tap opens it, the circle checks it off, a right swipe marks it done, a left swipe snoozes it, a long press opens the menu.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskRowView(row: Row, now: Long, actions: TaskActions, showProfile: Boolean, inDay: Boolean = false, onOpen: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val isDone = row.status == "done"
    val swipeable = row.status == "open"
    val current by rememberUpdatedState(row)
    val state = rememberSwipeToDismissBoxState(confirmValueChange = { v ->
        when (v) {
            SwipeToDismissBoxValue.StartToEnd -> actions.done(current)
            SwipeToDismissBoxValue.EndToStart -> actions.snooze(current, nextNine(now, current.profile))
            else -> {}
        }
        false
    })
    val later = nextNine(now, row.profile)
    val body = @Composable {
        Box(Modifier.background(av.groupCard)) {
            ListRow(
                title = row.title ?: "(Untitled)",
                meta = taskMeta(row, now, inDay, showProfile),
                leading = if (row.status == "note") null else { { CheckCircle(isDone, if (isDone) "Mark not done" else "Mark ${row.title} done") { if (isDone) actions.reopen(row) else actions.done(row) } } },
                trailing = if (row.status == "suggested") { { RowLabel("Needs you", av.warn) } } else null,
                strike = isDone,
                onClick = onOpen,
                onLongClick = { menu = true },
            )
            TaskMenu(row, menu, { menu = false }, actions, onOpen)
        }
    }
    if (!swipeable) { body(); return }
    SwipeToDismissBox(
        state = state,
        backgroundContent = {
            val dir = state.dismissDirection
            Box(Modifier.fillMaxSize().background(if (dir == SwipeToDismissBoxValue.StartToEnd) av.ok else if (dir == SwipeToDismissBoxValue.EndToStart) av.warn else av.groupCard).padding(horizontal = Tokens.sp8), contentAlignment = if (dir == SwipeToDismissBoxValue.StartToEnd) Alignment.CenterStart else Alignment.CenterEnd) {
                if (dir == SwipeToDismissBoxValue.StartToEnd) Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Filled.Check, null, tint = av.onColor); Text("  Done", color = av.onColor, style = Type.callout) }
                else if (dir == SwipeToDismissBoxValue.EndToStart) Row(verticalAlignment = Alignment.CenterVertically) { Text("${whenText(later, now)}  ", color = av.onColor, style = Type.callout); Icon(Icons.Filled.DateRange, null, tint = av.onColor) }
            }
        },
        content = { body() },
    )
}

@Composable
fun TaskMenu(row: Row, show: Boolean, dismiss: () -> Unit, actions: TaskActions, onOpen: () -> Unit) {
    val other = if (row.profile == WORK) PERSONAL else WORK
    Menu(show, dismiss) {
        MenuItem("Open", { dismiss(); onOpen() })
        if (row.status == "open") {
            MenuItem("Snooze", { dismiss(); actions.snoozeLater(row) })
            MenuItem("Tomorrow", { dismiss(); actions.tomorrow(row) })
        }
        if (row.status == "done") MenuItem("Not done", { dismiss(); actions.reopen(row) })
        MenuItem("Move to ${profileLabel(other)}", { dismiss(); actions.move(row, other) })
        MenuItem("Delete", { dismiss(); actions.delete(row) }, danger = true, icon = Icons.Filled.Delete)
    }
}

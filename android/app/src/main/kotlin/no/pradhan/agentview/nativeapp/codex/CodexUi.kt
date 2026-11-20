package no.pradhan.agentview.nativeapp.codex

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxState
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

// The Codex task row: check circle, meta line, swipes and the long-press menu.

@Composable
fun CheckCircle(done: Boolean, label: String, onClick: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    Box(Modifier.size(Tokens.leadWidth), contentAlignment = Alignment.Center) {
        Box(Modifier.requiredSize(Tokens.touch).clip(CircleShape).clickable(onClickLabel = label) { haptic.performHapticFeedback(HapticFeedbackType.Confirm); onClick() }, contentAlignment = Alignment.Center) {
            Box(Modifier.size(Tokens.sizeRow).clip(CircleShape).then(if (done) Modifier.background(av.okContainer) else Modifier.border(Tokens.stroke, av.fgFaint, CircleShape)), contentAlignment = Alignment.Center) {
                if (done) AvIcon("check", null, Tokens.size2xs, tint = av.onOkContainer)
            }
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
    val checks = checkItems(row.text)
    val extra = when {
        isRepeat(row.text) -> "Repeats"
        checks.isNotEmpty() -> "${checks.count { it.done }}/${checks.size}"
        !done && row.priority == 3 -> "High"
        !done && row.priority == 2 -> "Medium"
        else -> null
    }
    val tags = tagList(row.tags).joinToString(" ") { "#$it" }
    val preview = if (row.status == "note" && !isRepeat(row.text)) firstLine(row.text) else ""
    val bits = listOfNotNull(extra, tags.ifEmpty { null }, if (showProfile) profileLabel(row.profile) else null)
    return buildAnnotatedString {
        if (due != null) withStyle(SpanStyle(color = if (at != null && at < now) av.err else av.fgMuted)) { append(due) }
        if (due != null && bits.isNotEmpty()) append(" · ")
        append(bits.joinToString(" · "))
        if (due == null && bits.isEmpty()) append(preview)
    }
}

// A left swipe past this share of the row deletes instead of snoozing.
private const val SWIPE_DELETE = 0.55f
fun deletesOnSwipe(dx: Float, width: Float) = -dx > width * SWIPE_DELETE

// An open task: tap opens it, the circle checks it off, a right swipe marks it done, a left swipe snoozes it, a long left swipe deletes it, a long press opens the menu.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskRowView(row: Row, now: Long, actions: TaskActions, showProfile: Boolean, inDay: Boolean = false, onOpen: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    val isDone = row.status == "done"
    val swipeable = row.status == "open"
    val current by rememberUpdatedState(row)
    var width by remember { mutableFloatStateOf(1f) }
    lateinit var state: SwipeToDismissBoxState
    state = rememberSwipeToDismissBoxState(confirmValueChange = { v ->
        when (v) {
            SwipeToDismissBoxValue.StartToEnd -> { haptic.performHapticFeedback(HapticFeedbackType.Confirm); actions.done(current) }
            SwipeToDismissBoxValue.EndToStart -> if (deletesOnSwipe(state.requireOffset(), width)) actions.delete(current) else actions.snooze(current, nextNine(now, current.profile))
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
                state = if (row.status == "suggested") ({ Badge("Needs you", BadgeTone.Waiting) }) else null,
                stateSlot = true,
                menu = { dismiss -> TaskMenu(row, dismiss, actions, onOpen) },
                strike = isDone,
                onClick = onOpen,
            )
        }
    }
    if (!swipeable) { body(); return }
    SwipeToDismissBox(
        state = state,
        modifier = Modifier.onSizeChanged { width = it.width.toFloat() },
        backgroundContent = {
            val dir = state.dismissDirection
            val deleting = dir == SwipeToDismissBoxValue.EndToStart && deletesOnSwipe(state.requireOffset(), width)
            Box(Modifier.fillMaxSize().background(if (dir == SwipeToDismissBoxValue.StartToEnd) av.okContainer else if (deleting) av.errContainer else if (dir == SwipeToDismissBoxValue.EndToStart) av.warnContainer else av.groupCard).padding(horizontal = Tokens.sp8), contentAlignment = if (dir == SwipeToDismissBoxValue.StartToEnd) Alignment.CenterStart else Alignment.CenterEnd) {
                if (dir == SwipeToDismissBoxValue.StartToEnd) Row(verticalAlignment = Alignment.CenterVertically) { AvIcon("check", null, Tokens.icon, tint = av.onOkContainer); Text("  Done", color = av.onOkContainer, style = Type.callout) }
                else if (deleting) Row(verticalAlignment = Alignment.CenterVertically) { Text("Delete  ", color = av.onErrContainer, style = Type.callout); AvIcon("trash", null, Tokens.icon, tint = av.onErrContainer) }
                else if (dir == SwipeToDismissBoxValue.EndToStart) Row(verticalAlignment = Alignment.CenterVertically) { Text("${whenText(later, now)}  ", color = av.onWarnContainer, style = Type.callout); AvIcon("calendar", null, Tokens.icon, tint = av.onWarnContainer) }
            }
        },
        content = { body() },
    )
}

@Composable
fun ColumnScope.TaskMenu(row: Row, dismiss: () -> Unit, actions: TaskActions, onOpen: () -> Unit) {
    val other = if (row.profile == WORK) PERSONAL else WORK
    MenuItem("Open", "arrow-right", { dismiss(); onOpen() })
    if (row.status == "open") {
        MenuItem("Snooze", "clock", { dismiss(); actions.snoozeLater(row) })
        MenuItem("Tomorrow", "calendar", { dismiss(); actions.tomorrow(row) })
    }
    if (row.status == "done") MenuItem("Not done", "discard", { dismiss(); actions.reopen(row) })
    MenuItem("Move to ${profileLabel(other)}", "arrow-swap", { dismiss(); actions.move(row, other) })
    MenuItem("Delete", "trash", { dismiss(); actions.delete(row) }, danger = true)
}

package no.pradhan.agentview.nativeapp.codex

import no.pradhan.agentview.nativeapp.ui.UNTITLED
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SwipeLabel
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

// The Codex task row: check circle, meta line, swipes and the long-press menu.

@Composable
fun CheckCircle(done: Boolean, label: String, ring: Color? = null, onClick: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    Box(Modifier.size(Tokens.leadWidth), contentAlignment = Alignment.Center) {
        Box(Modifier.requiredSize(Tokens.touch).clip(CircleShape).clickable(onClickLabel = label) { haptic.performHapticFeedback(HapticFeedbackType.Confirm); onClick() }, contentAlignment = Alignment.Center) {
            Box(Modifier.size(Tokens.sizeRow).clip(CircleShape).then(if (done) Modifier.background(av.okContainer) else Modifier.border(Tokens.stroke, ring ?: av.fgFaint, CircleShape)), contentAlignment = Alignment.Center) {
                if (done) AvIcon("check", null, Tokens.size2xs, tint = av.onOkContainer)
            }
        }
    }
}

fun profileLabel(p: String) = if (p == WORK) "Work" else "Personal"
fun priorityLabel(p: Int) = when (p) { 3 -> "High"; 2 -> "Medium"; 1 -> "Low"; else -> "None" }

data class TaskMetaParts(val extra: String, val preview: String)

// web taskMetaParts in codex/tasks/taskMeta.ts: Repeats, the checklist count, or High or Medium on an open row; and a note's first line as its preview, when it has no checklist, no people and is not a bare URL.
fun taskMetaParts(row: Row): TaskMetaParts {
    val done = row.status == "done"
    val checks = checkItems(row.text)
    val first = if (isRepeat(row.text)) "" else firstLine(row.text)
    val extra = when {
        isRepeat(row.text) -> "Repeats"
        checks.isNotEmpty() -> "${checks.count { it.done }}/${checks.size}"
        !done && row.priority == 3 -> "High"
        !done && row.priority == 2 -> "Medium"
        else -> ""
    }
    val preview = if (row.status == "note" && checks.isEmpty() && row.people.isNullOrEmpty() && !BARE_URL.matches(first)) first else ""
    return TaskMetaParts(extra, preview)
}

private val BARE_URL = Regex("^https?://\\S+$")

// The meta line of a task: due text (red when late), then repeat, checklist or priority, else a note's preview.
@Composable
fun taskMeta(row: Row, now: Long, inDay: Boolean): androidx.compose.ui.text.AnnotatedString {
    val due = dueText(row, now, inDay)
    val at = row.at
    val (extra, preview) = taskMetaParts(row)
    return buildAnnotatedString {
        if (due != null) withStyle(SpanStyle(color = if (at != null && at < now) av.err else av.fgMuted)) { append(due) }
        if (due != null && extra.isNotEmpty()) append(" · ")
        append(extra)
        if (due == null && extra.isEmpty()) append(preview)
    }
}

// A left swipe past this share of the row deletes instead of snoozing.
private const val SWIPE_DELETE = 0.55f
fun deletesOnSwipe(dx: Float, width: Float) = -dx > width * SWIPE_DELETE

// Selection on a row: picking is on once any row is chosen, toggle chooses or drops this row. A long press toggles.
class RowPick(val picking: Boolean, val selected: Boolean, val toggle: () -> Unit)

// An open task: tap opens it, the circle checks it off, a right swipe marks it done, a left swipe snoozes it, a long left swipe deletes it, a long press opens the menu, or with pick starts selecting.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskRowView(row: Row, now: Long, actions: TaskActions, inDay: Boolean = false, pick: RowPick? = null, onOpen: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    val isDone = row.status == "done"
    val picking = pick?.picking == true
    val swipeable = row.status == "open" && !picking
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
    val ring = if (isDone) null else if (row.profile == WORK) av.work else av.personal
    val body = @Composable {
        Box(Modifier.background(av.groupCard)) {
            ListRow(
                title = row.title ?: UNTITLED,
                meta = taskMeta(row, now, inDay),
                leading = if (row.status == "note") null else if (picking) { { CheckCircle(pick!!.selected, if (pick.selected) "Deselect ${row.title}" else "Select ${row.title}", ring) { pick.toggle() } } } else { { CheckCircle(isDone, if (isDone) "Mark not done" else "Mark ${row.title} done", ring) { if (isDone) actions.reopen(row) else actions.done(row) } } },
                state = if (row.status == "suggested") ({ Badge("Needs you", BadgeTone.Waiting) }) else null,
                stateSlot = true,
                menu = { dismiss -> TaskMenu(row, dismiss, actions, onOpen) },
                strike = isDone,
                selected = pick?.selected == true,
                onClick = if (picking) pick!!.toggle else onOpen,
                onLongClick = pick?.toggle,
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
            when {
                dir == SwipeToDismissBoxValue.StartToEnd -> SwipeLabel(av.okContainer, "check", "Done", av.onOkContainer, start = true)
                deleting -> SwipeLabel(av.errContainer, "trash", "Delete", av.onErrContainer)
                dir == SwipeToDismissBoxValue.EndToStart -> SwipeLabel(av.warnContainer, "calendar", whenText(later, now), av.onWarnContainer)
                else -> SwipeLabel(av.groupCard)
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

// The bar over a task selection: the count, done, tomorrow, snooze and delete on all chosen rows, the row menu when one is chosen, and an X that exits.
@Composable
fun SelectionBar(count: Int, bulk: (BulkKind) -> Unit, exit: () -> Unit, modifier: Modifier = Modifier, menu: (@Composable ColumnScope.(dismiss: () -> Unit) -> Unit)? = null) {
    val on = count > 0
    Row(modifier.fillMaxWidth().background(av.groupCard).padding(horizontal = Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
        IconBtn("close", "Exit selection", exit)
        Text("$count selected", Modifier.weight(1f), color = av.fg, style = Type.callout)
        IconBtn("check", "Done", { bulk(BulkKind.Done) }, enabled = on)
        IconBtn("calendar", "Tomorrow", { bulk(BulkKind.Tomorrow) }, enabled = on)
        IconBtn("clock", "Snooze", { bulk(BulkKind.Snooze) }, enabled = on)
        IconBtn("trash", "Delete", { bulk(BulkKind.Delete) }, enabled = on, tint = av.err)
        if (menu != null) MoreButton(content = menu)
    }
}

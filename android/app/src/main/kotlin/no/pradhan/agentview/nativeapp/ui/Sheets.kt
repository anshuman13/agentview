package no.pradhan.agentview.nativeapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Velocity
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.activity.compose.BackHandler
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.SnackbarVisuals
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.foundation.clickable
import androidx.compose.runtime.key
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.first
import androidx.compose.material3.Text
import androidx.compose.ui.platform.LocalAccessibilityManager
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.snackMillis
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.unit.dp

// Bottom sheet (web Sheet): a card that rises over a scrim, with a drag handle and a title row. With `onBack`, a back arrow leads the title row and system Back calls it instead of closing the sheet.
// With `motion`, it opens and closes with the shared sheet motion; the content keeps the app's motion.
@Composable
fun Sheet(onDismiss: () -> Unit, title: String, padded: Boolean = true, full: Boolean = true, count: String? = null, action: (@Composable () -> Unit)? = null, onBack: (() -> Unit)? = null, scroll: ScrollState = rememberScrollState(), motion: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    if (!motion) return SheetBody(onDismiss, title, padded, full, count, action, onBack, scroll, content)
    SheetMotion { keep -> SheetBody(onDismiss, title, padded, full, count, action, onBack, scroll) { val col = this; keep { col.content() } } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetBody(onDismiss: () -> Unit, title: String, padded: Boolean, full: Boolean, count: String?, action: (@Composable () -> Unit)?, onBack: (() -> Unit)?, scroll: ScrollState, content: @Composable ColumnScope.() -> Unit) {
    val c = av
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = full),
        properties = ModalBottomSheetProperties(shouldDismissOnBackPress = onBack == null),
        containerColor = c.containerLow,
        contentColor = c.fg,
        scrimColor = c.scrim,
        shape = RoundedCornerShape(topStart = Tokens.radiusSheet, topEnd = Tokens.radiusSheet),
        tonalElevation = 0.dp,
        dragHandle = {
            Box(Modifier.fillMaxWidth().height(Tokens.sp24).semantics { contentDescription = "Drag handle" }, contentAlignment = Alignment.Center) {
                Box(Modifier.size(Tokens.handleWidth, Tokens.handleHeight).clip(RoundedCornerShape(Tokens.radiusXs)).background(c.borderStrong))
            }
        },
    ) {
        if (onBack != null) BackHandler(onBack = onBack)
        // The sheet is its own window: no text in it may register with a SelectionContainer behind it (that crashes on a long press), so the body gets its own.
        DisableSelection { Column(Modifier.navigationBarsPadding().nestedScroll(remember { DragOnlyToSheet() }).verticalScroll(scroll).padding(bottom = Tokens.sp8)) {
            Row(Modifier.fillMaxWidth().height(Tokens.rowOne).padding(start = if (onBack != null) Tokens.sp2 else Tokens.listPad, end = if (action != null) Tokens.sp2 else Tokens.listPad), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                if (onBack != null) IconBtn("arrow-left", "Back", onBack, tint = c.fg)
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                    Text(title, Modifier.weight(1f, fill = false), style = Type.title, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (count != null) Badge(count, BadgeTone.Quiet)
                }
                action?.invoke()
            }
            SelectionContainer { Column(Modifier.padding(horizontal = if (padded) Tokens.sp8 else 0.dp), content = content) }
        } }
    }
}

// For a sheet that hosts its own scrolling list (a file): drags and flings inside never move the sheet; the handle and title still do.
fun Modifier.keepScrollInside(): Modifier = nestedScroll(KeepScrollInside)

private object KeepScrollInside : NestedScrollConnection {
    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource) = available
    override suspend fun onPostFling(consumed: Velocity, available: Velocity) = available
}

// The content's leftover fling stops here: a fling that runs the content out of room would otherwise fling the sheet shut.
// A drag past the top still moves the sheet, and its release velocity passes so the sheet settles open or closed.
private class DragOnlyToSheet : NestedScrollConnection {
    private var dragged = false
    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
        if (source == NestedScrollSource.UserInput && available.y != 0f) dragged = true
        return Offset.Zero
    }
    override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
        val pass = dragged
        dragged = false
        return if (pass) Velocity.Zero else available
    }
}

// Menu (web Menu): raised card with elevation 3; items are touch height, danger items red.
@Composable
fun Menu(expanded: Boolean, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    DropdownMenu(
        expanded, onDismiss,
        modifier = Modifier.widthIn(min = Tokens.menuMin),
        shape = RoundedCornerShape(Tokens.shapeLg),
        containerColor = av.raised,
        tonalElevation = 0.dp,
        shadowElevation = Tokens.elev3,
    ) { DisableSelection { content() } }
}

@Composable
fun MenuItem(text: String, icon: String, onClick: () -> Unit, danger: Boolean = false, enabled: Boolean = true, checked: Boolean = false) {
    val color = if (danger) av.danger else av.fg
    DropdownMenuItem(
        text = {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                if (checked || icon.isNotEmpty()) AvIcon(if (checked) "check" else icon, null, Tokens.iconMd) else Spacer(Modifier.size(Tokens.iconMd))
                Text(text, style = Type.body)
            }
        },
        onClick = onClick,
        enabled = enabled,
        colors = MenuDefaults.itemColors(textColor = color, leadingIconColor = color),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Tokens.sp6),
        modifier = Modifier.padding(horizontal = Tokens.sp2).clip(RoundedCornerShape(Tokens.radius)).heightIn(min = Tokens.touch),
    )
}

// A small heading over a group of menu items.
@Composable
fun MenuLabel(text: String) = Text(text, Modifier.padding(start = Tokens.sp6, end = Tokens.sp6, top = Tokens.sp3, bottom = Tokens.sp2), style = Type.label, color = av.fgMuted)

@Composable
fun MenuSeparator() = HorizontalDivider(Modifier.padding(vertical = Tokens.sp2), color = av.border, thickness = Tokens.hairline)

// The "more" icon button that opens a menu.
@Composable
fun MoreButton(label: String = "More", expanded: MutableState<Boolean> = remember { mutableStateOf(false) }, content: @Composable ColumnScope.(dismiss: () -> Unit) -> Unit) {
    var open by expanded
    Box {
        IconBtn("kebab-vertical", label, { open = true })
        Box(Modifier.matchParentSize().padding(end = Tokens.sp4)) { Menu(open, { open = false }) { content { open = false } } }
    }
}

// Snackbar (web .as-snack): inverse surface with an inverse primary action. A tap or a sideways swipe dismisses it.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SnackHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    SnackbarHost(state, modifier) { data ->
        val swipe = key(data) { rememberSwipeToDismissBoxState(confirmValueChange = { v -> if (v != SwipeToDismissBoxValue.Settled) data.dismiss(); v != SwipeToDismissBoxValue.Settled }) }
        SwipeToDismissBox(swipe, backgroundContent = {}) {
            Snackbar(
                data,
                modifier = Modifier.clickable { data.dismiss() },
                shape = RoundedCornerShape(Tokens.radius),
                containerColor = av.inverseSurface,
                contentColor = av.inverseOnSurface,
                actionColor = av.inversePrimary,
            )
        }
    }
}

// Shows a snack for snackMillis, dismissing the one showing first (web showSnack).
@Composable
fun rememberShowSnack(state: SnackbarHostState): suspend (String, String?, Long) -> SnackbarResult {
    val access = LocalAccessibilityManager.current
    return remember(state, access) {
        { text, action, ms ->
            coroutineScope {
                state.currentSnackbarData?.dismiss()
                val shown = snackMillis(ms, access?.calculateRecommendedTimeoutMillis(ms, containsIcons = false, containsText = true, containsControls = action != null) ?: 0L)
                val visuals = object : SnackbarVisuals {
                    override val message = text
                    override val actionLabel = action
                    override val withDismissAction = false
                    override val duration = SnackbarDuration.Indefinite
                }
                val timer = launch {
                    snapshotFlow { state.currentSnackbarData?.visuals === visuals }.first { it }
                    delay(shown)
                    state.currentSnackbarData?.takeIf { it.visuals === visuals }?.dismiss()
                }
                try { state.showSnackbar(visuals) } finally { timer.cancel() }
            }
        }
    }
}

// Confirm and text dialogs (web Confirm): raised card, plain actions, the destructive one in red.
@Composable
fun ConfirmDialog(title: String, detail: String, action: String, onConfirm: () -> Unit, danger: Boolean = true, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = av.raised,
        shape = RoundedCornerShape(Tokens.shapeLg),
        title = { DisableSelection { Text(title, style = Type.headline, color = av.fg) } },
        text = { DisableSelection { Text(detail, style = Type.body, color = av.fgMuted) } },
        confirmButton = { DisableSelection { Button(action, { onConfirm(); onDismiss() }, variant = if (danger) ButtonVariant.Danger else ButtonVariant.Filled) } },
        dismissButton = { DisableSelection { Button("Cancel", onDismiss, variant = ButtonVariant.Plain) } },
    )
}

@Composable
fun TextDialog(title: String, initial: String, action: String, onSave: (String) -> Unit, onDismiss: () -> Unit, maxLength: Int = Int.MAX_VALUE, detail: String? = null) {
    var field by remember { mutableStateOf(TextFieldValue(initial, TextRange(initial.length))) }
    val text = field.text
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = av.raised,
        shape = RoundedCornerShape(Tokens.shapeLg),
        title = { DisableSelection { Text(title, style = Type.headline, color = av.fg) } },
        text = {
            DisableSelection { Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                if (!detail.isNullOrEmpty()) Text(detail, style = Type.body, color = av.fgMuted)
                TextField(field, { if (it.text.length <= maxLength) field = it }, Modifier.focusRequester(focus), singleLine = true)
            } }
        },
        confirmButton = { DisableSelection { Button(action, { onSave(text); onDismiss() }, variant = ButtonVariant.Filled) } },
        dismissButton = { DisableSelection { Button("Cancel", onDismiss, variant = ButtonVariant.Plain) } },
    )
}

package no.pradhan.agentview.nativeapp
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

// Bottom sheet (web Sheet): a card that rises over a scrim, with a drag handle and a title row.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Sheet(onDismiss: () -> Unit, title: String, padded: Boolean = true, full: Boolean = true, count: String? = null, action: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = av
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = full),
        containerColor = c.containerLow,
        contentColor = c.fg,
        scrimColor = c.scrimStrong,
        shape = RoundedCornerShape(topStart = Tokens.radiusSheet, topEnd = Tokens.radiusSheet),
        tonalElevation = 0.dp,
        dragHandle = {
            Box(Modifier.fillMaxWidth().height(Tokens.sp24), contentAlignment = Alignment.Center) {
                Box(Modifier.size(Tokens.handleWidth, Tokens.handleHeight).clip(RoundedCornerShape(Tokens.radiusXs)).background(c.borderStrong))
            }
        },
    ) {
        Column(Modifier.navigationBarsPadding().verticalScroll(rememberScrollState()).padding(bottom = Tokens.sp8)) {
            Row(Modifier.fillMaxWidth().height(Tokens.rowOne).padding(start = Tokens.listPad, end = if (action != null) Tokens.sp2 else Tokens.listPad), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                Text(title, Modifier.weight(1f, fill = false), style = Type.title, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (count != null) Badge(count, BadgeTone.Quiet)
                if (action != null) { Spacer(Modifier.weight(1f)); action() }
            }
            Column(Modifier.padding(horizontal = if (padded) Tokens.sp8 else 0.dp), content = content)
        }
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
        content = content,
    )
}

@Composable
fun MenuItem(text: String, icon: String, onClick: () -> Unit, danger: Boolean = false, enabled: Boolean = true, checked: Boolean = false) {
    val color = if (danger) av.danger else av.fg
    DropdownMenuItem(
        text = {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                AvIcon(if (checked) "check" else icon, null, Tokens.iconMd)
                Text(text, style = Type.body)
            }
        },
        onClick = onClick,
        enabled = enabled,
        colors = MenuDefaults.itemColors(textColor = color, leadingIconColor = color),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = Tokens.sp6),
        modifier = Modifier.heightIn(min = Tokens.touch),
    )
}

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

// Snackbar (web .as-snack): inverse surface with an inverse primary action.
@Composable
fun SnackHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    SnackbarHost(state, modifier) { data ->
        Snackbar(
            data,
            shape = RoundedCornerShape(Tokens.radius),
            containerColor = av.inverseSurface,
            contentColor = av.inverseOnSurface,
            actionColor = av.inversePrimary,
        )
    }
}

// Confirm and text dialogs (web Confirm): raised card, plain actions, the destructive one in red.
@Composable
fun ConfirmDialog(title: String, detail: String, action: String, onConfirm: () -> Unit, danger: Boolean = true, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = av.raised,
        shape = RoundedCornerShape(Tokens.shapeLg),
        title = { Text(title, style = Type.headline, color = av.fg) },
        text = { Text(detail, style = Type.body, color = av.fgMuted) },
        confirmButton = { Button(action, { onConfirm(); onDismiss() }, variant = if (danger) ButtonVariant.Danger else ButtonVariant.Filled) },
        dismissButton = { Button("Cancel", onDismiss, variant = ButtonVariant.Plain) },
    )
}

@Composable
fun TextDialog(title: String, initial: String, action: String, onSave: (String) -> Unit, onDismiss: () -> Unit, maxLength: Int = Int.MAX_VALUE, detail: String? = null) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = av.raised,
        shape = RoundedCornerShape(Tokens.shapeLg),
        title = { Text(title, style = Type.headline, color = av.fg) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                if (!detail.isNullOrEmpty()) Text(detail, style = Type.body, color = av.fgMuted)
                TextField(text, { if (it.length <= maxLength) text = it }, singleLine = true)
            }
        },
        confirmButton = { Button(action, { onSave(text); onDismiss() }, variant = ButtonVariant.Filled) },
        dismissButton = { Button("Cancel", onDismiss, variant = ButtonVariant.Plain) },
    )
}

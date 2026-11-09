package no.pradhan.agentview.nativeapp
import androidx.compose.runtime.getValue

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow

// Text field (web input): sunken fill, hairline border that turns accent on focus.
@Composable
fun TextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    singleLine: Boolean = false,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    pill: Boolean = false,
    style: TextStyle = Type.body,
) {
    val c = av
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(if (pill) Tokens.radiusPill else Tokens.radiusSm)
    BasicTextField(
        value, onValueChange,
        modifier.fillMaxWidth(),
        textStyle = style.copy(color = c.fg),
        cursorBrush = SolidColor(c.accent),
        singleLine = singleLine, minLines = minLines, maxLines = maxLines,
        keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
        interactionSource = interaction,
        decorationBox = { inner ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = Tokens.touch).clip(shape).background(c.sunken).border(Tokens.hairline, if (focused) c.accent else c.border, shape)
                    .padding(start = if (leading != null) Tokens.sp4 else Tokens.sp6, end = if (trailing != null) Tokens.sp1 else Tokens.sp6),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Tokens.sp3),
            ) {
                leading?.invoke()
                Box(Modifier.weight(1f).padding(vertical = Tokens.sp4)) {
                    if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, style = style, color = c.fgMuted, maxLines = if (singleLine) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
                    inner()
                }
                trailing?.invoke()
            }
        },
    )
}

// Search field (web .jb-search): a pill with a search glyph and a clear button.
@Composable
fun SearchField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    TextField(
        value, onValueChange, modifier.padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), placeholder = placeholder, singleLine = true, pill = true,
        leading = { AvIcon("search", null, Tokens.iconMd, tint = av.fgMuted) },
        trailing = if (value.isNotEmpty()) { { IconBtn("close", "Clear", { onValueChange("") }) } } else null,
    )
}

// Field label above a group of controls in a sheet.
@Composable
fun FieldLabel(text: String) = Text(text, style = Type.label, color = av.fgMuted)

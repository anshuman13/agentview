package no.pradhan.agentview.nativeapp.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

// A day picker; DatePicker counts in UTC midnights, so the day goes in and comes out as a LocalDate.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateDialog(initial: LocalDate, confirm: String, dismiss: String, onConfirm: (LocalDate?) -> Unit, onDismissButton: () -> Unit, onDismiss: () -> Unit) {
    val picker = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = { DisableSelection { Button(confirm, { onConfirm(picker.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) } },
        dismissButton = { DisableSelection { Button(dismiss, onDismissButton, variant = ButtonVariant.Plain, size = ButtonSize.Sm) } },
    ) { DisableSelection { DatePicker(picker) } }
}

// A 24-hour time picker on the app's raised surface.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeDialog(title: String, hour: Int, minute: Int, confirm: String, dismiss: String, onConfirm: (Int, Int) -> Unit, onDismissButton: () -> Unit, onDismiss: () -> Unit) {
    val time = rememberTimePickerState(initialHour = hour, initialMinute = minute, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = av.raised,
        shape = RoundedCornerShape(Tokens.shapeLg),
        title = { DisableSelection { Text(title, style = Type.headline, color = av.fg) } },
        text = { DisableSelection { TimePicker(time) } },
        confirmButton = { DisableSelection { Button(confirm, { onConfirm(time.hour, time.minute) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm) } },
        dismissButton = { DisableSelection { Button(dismiss, onDismissButton, variant = ButtonVariant.Plain, size = ButtonSize.Sm) } },
    )
}

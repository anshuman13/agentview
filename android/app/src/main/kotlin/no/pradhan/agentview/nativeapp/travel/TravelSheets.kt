package no.pradhan.agentview.nativeapp.travel

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.DateDialog
import no.pradhan.agentview.nativeapp.ui.FieldLabel
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens

internal fun idJson(id: String) = buildJsonObject { put("id", id) }.toString()

internal fun tripJson(t: Trip) = buildJsonObject {
    if (t.id.isNotEmpty()) put("id", t.id)
    put("name", t.name); put("from", t.from); put("to", t.to); put("notes", t.notes)
}.toString()

// A date row that opens the date picker; empty shows the placeholder.
@Composable
private fun DateRow(label: String, value: String, onPick: (String) -> Unit) {
    var picking by remember { mutableStateOf(false) }
    ListRow(label, value.ifEmpty { "Pick a date" }, onClick = { picking = true })
    if (picking) DateDialog(
        runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now()), "OK", "Clear",
        onConfirm = { d -> onPick(d?.toString() ?: ""); picking = false },
        onDismissButton = { onPick(""); picking = false },
        onDismiss = { picking = false },
    )
}

@Composable
fun TripSheet(hub: Hub, trip: Trip?, onDismiss: () -> Unit, onSaved: (String) -> Unit) {
    var name by remember { mutableStateOf(trip?.name ?: "") }
    var from by remember { mutableStateOf(trip?.from ?: "") }
    var to by remember { mutableStateOf(trip?.to ?: "") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val save = {
        busy = true
        scope.launch {
            var id = ""
            val ok = hub.travelWrite {
                val body = api.post("/api/travel/trip", tripJson((trip ?: Trip("", "")).copy(name = name.trim(), from = from, to = to.ifEmpty { from })))
                id = protocolJson.decodeFromString(Trip.serializer(), body).id
            }
            busy = false
            if (ok) onSaved(id)
        }
    }
    Sheet(onDismiss, if (trip == null) "New trip" else "Edit trip", full = false) {
        TextField(name, { name = it }, Modifier.fillMaxWidth(), placeholder = "Trip, such as Stockholm offsite", singleLine = true)
        DateRow("From", from) { from = it; if (to.isEmpty() || to < it) to = it }
        DateRow("To", to) { to = it }
        Button("Save", { save() }, Modifier.fillMaxWidth().padding(top = Tokens.sp4), variant = ButtonVariant.Filled, enabled = !busy && name.isNotBlank(), fill = true)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReceiptSheet(hub: Hub, r: Receipt, onOpen: () -> Unit, onDismiss: () -> Unit, onSaved: () -> Unit) {
    var merchant by remember(r.id, r.read) { mutableStateOf(r.merchant) }
    var amount by remember(r.id, r.read) { mutableStateOf(r.amount?.let(::formatAmount) ?: "") }
    var currency by remember(r.id, r.read) { mutableStateOf(r.currency) }
    var date by remember(r.id, r.read) { mutableStateOf(r.date) }
    var category by remember(r.id, r.read) { mutableStateOf(r.category) }
    var note by remember(r.id, r.read) { mutableStateOf(r.note) }
    val scope = rememberCoroutineScope()
    val save = {
        scope.launch {
            val body = buildJsonObject {
                put("id", r.id); put("merchant", merchant); put("amount", amount); put("currency", currency)
                put("date", date); put("category", category); put("note", note)
            }.toString()
            if (hub.travelWrite { api.post("/api/travel/receipt/update", body) }) { onSaved(); onDismiss() }
        }
    }
    val remove = {
        scope.launch { if (hub.travelWrite { api.post("/api/travel/receipt/delete", idJson(r.id)) }) { hub.notice.value = "Receipt deleted"; onSaved(); onDismiss() } }
    }
    Sheet(onDismiss, if (r.read == "pending") "Claude is reading this receipt…" else r.merchant.ifEmpty { r.name }) {
        if (isImage(r)) {
            val img by produceState<ImageBitmap?>(null, r.id) { value = receiptImage(hub, r.id, 1600) }
            img?.let { Image(it, r.name, Modifier.fillMaxWidth().heightIn(max = 360.dp).clickable(onClick = onOpen), contentScale = ContentScale.Fit) }
        } else Button("Open ${r.name}", onOpen, Modifier.fillMaxWidth(), icon = if (r.mime == "application/pdf") "file-pdf" else "file", fill = true)
        FieldLabel("Merchant")
        TextField(merchant, { merchant = it }, Modifier.fillMaxWidth(), placeholder = "Merchant", singleLine = true)
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            TextField(amount, { amount = it }, Modifier.weight(1f), placeholder = "Amount", singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            TextField(currency, { currency = it.uppercase().take(3) }, Modifier.width(88.dp), placeholder = "NOK", singleLine = true)
        }
        DateRow("Date", date) { date = it }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp2), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            CATEGORIES.forEach { c -> Chip(c, { category = c }, on = category == c) }
        }
        TextField(note, { note = it }, Modifier.fillMaxWidth(), placeholder = "Note, such as dinner with the Bergen team")
        Row(Modifier.fillMaxWidth().padding(top = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Button("Delete", { remove() }, Modifier.weight(1f), variant = ButtonVariant.Danger, icon = "trash", fill = true)
            Button("Save", { save() }, Modifier.weight(1f), variant = ButtonVariant.Filled, fill = true)
        }
        Spacer(Modifier.padding(bottom = Tokens.sp8))
    }
}

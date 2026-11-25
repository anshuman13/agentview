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
import kotlinx.serialization.builtins.ListSerializer
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

internal fun checkJson(trip: String, id: String, done: Boolean) = buildJsonObject { put("trip", trip); put("id", id); put("done", done) }.toString()

// Sends the fields a save changes: notes only from the Notes save, the whole plan only from the item sheet.
internal fun tripJson(t: Trip, notes: String? = null, plan: List<PlanItem>? = null) = buildJsonObject {
    if (t.id.isNotEmpty()) put("id", t.id)
    put("name", t.name); put("from", t.from); put("to", t.to)
    notes?.let { put("notes", it) }
    plan?.let { put("plan", protocolJson.encodeToJsonElement(ListSerializer(PlanItem.serializer()), it)) }
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
    Sheet(onDismiss, if (trip == null) "New trip" else "Edit trip", full = false, motion = true) {
        TextField(name, { name = it }, Modifier.fillMaxWidth(), placeholder = "Trip, such as Stockholm offsite", singleLine = true)
        DateRow("From", from) { from = it; if (to.isEmpty() || to < it) to = it }
        DateRow("To", to) { to = it }
        Button("Save", { save() }, Modifier.fillMaxWidth().padding(top = Tokens.sp4), variant = ButtonVariant.Filled, enabled = !busy && name.isNotBlank(), fill = true)
    }
}

// The start address Claude plans the way to the airport from; empty clears it.
@Composable
fun HomeSheet(hub: Hub, home: String, onDismiss: () -> Unit, onSaved: () -> Unit) {
    var value by remember { mutableStateOf(home) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val save = {
        busy = true
        scope.launch {
            val ok = hub.travelWrite { api.post("/api/travel/home", buildJsonObject { put("home", value) }.toString()) }
            busy = false
            if (ok) { hub.notice.value = "Home address saved"; onSaved(); onDismiss() }
        }
    }
    Sheet(onDismiss, "Home address", full = false, motion = true) {
        TextField(value, { value = it }, Modifier.fillMaxWidth(), placeholder = "Street, city", singleLine = true)
        Button("Save", { save() }, Modifier.fillMaxWidth().padding(top = Tokens.sp4), variant = ButtonVariant.Filled, enabled = !busy, fill = true)
    }
}

// Adds or edits one plan item, or deletes it; an item save sends the whole plan.
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlanItemSheet(hub: Hub, trip: Trip, item: PlanItem?, today: String, onDismiss: () -> Unit, onSaved: () -> Unit) {
    var kind by remember { mutableStateOf(item?.kind ?: "event") }
    var title by remember { mutableStateOf(item?.title ?: "") }
    var day by remember { mutableStateOf(item?.day ?: if (tripState(trip, today) == "now") today else trip.from.ifEmpty { today }) }
    var start by remember { mutableStateOf(item?.start ?: "") }
    var end by remember { mutableStateOf(item?.end ?: "") }
    var place by remember { mutableStateOf(item?.place ?: "") }
    var ref by remember { mutableStateOf(item?.ref ?: "") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val write = { plan: List<PlanItem>, done: () -> Unit ->
        busy = true
        scope.launch {
            val ok = hub.travelWrite("Could not save the item. Your text is still here.") { api.post("/api/travel/trip", tripJson(trip, plan = plan)) }
            busy = false
            if (ok) { done(); onSaved(); onDismiss() }
        }
        Unit
    }
    val save = {
        val next = PlanItem(item?.id ?: "", day, start.trim(), end.trim(), kind, title.trim(), place.trim(), ref.trim())
        write(if (item == null) trip.plan + next else trip.plan.map { if (it.id == item.id) next else it }) {}
    }
    Sheet(onDismiss, if (item == null) "Add item" else "Edit item", motion = true) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Tokens.sp2), verticalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            PLAN_KINDS.forEach { k -> Chip(k.replaceFirstChar { it.uppercase() }, { kind = k }, on = kind == k) }
        }
        TextField(title, { title = it }, Modifier.fillMaxWidth(), placeholder = "Title, such as OSL to ARN", singleLine = true)
        DateRow("Day", day) { day = it }
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            TextField(start, { start = it.take(5) }, Modifier.weight(1f), placeholder = "Start HH:MM", singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            TextField(end, { end = it.take(5) }, Modifier.weight(1f), placeholder = "End HH:MM", singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        }
        TextField(place, { place = it }, Modifier.fillMaxWidth(), placeholder = "Place", singleLine = true)
        TextField(ref, { ref = it }, Modifier.fillMaxWidth(), placeholder = "Booking or flight number", singleLine = true)
        Row(Modifier.fillMaxWidth().padding(top = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            if (item != null) Button("Delete", { write(trip.plan.filter { it.id != item.id }) { hub.notice.value = "Item deleted" } }, Modifier.weight(1f), variant = ButtonVariant.Danger, icon = "trash", enabled = !busy, fill = true)
            Button("Save", { save() }, Modifier.weight(1f), variant = ButtonVariant.Filled, enabled = !busy && title.isNotBlank() && day.isNotEmpty(), fill = true)
        }
        Spacer(Modifier.padding(bottom = Tokens.sp8))
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
    Sheet(onDismiss, if (r.read == "pending") "Claude is reading this receipt…" else r.merchant.ifEmpty { r.name }, motion = true) {
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

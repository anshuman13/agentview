package no.pradhan.agentview.nativeapp.travel

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.chat.Attach
import no.pradhan.agentview.nativeapp.chat.rememberAttach
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.PageHeader
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.TextField
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.ui.plural
import no.pradhan.agentview.nativeapp.ui.rememberLoad

private const val FOLD = 5
private const val POLL_MS = 2500L

// A write to the Mac; false after a failure (shown as a notice) or in a read-only run.
internal suspend fun Hub.travelWrite(failure: String? = null, block: suspend Hub.() -> Unit): Boolean =
    if (readOnly) { notice.value = READ_ONLY_SENT; false }
    else runCatching { block() }.onFailure { notice.value = failure ?: it.message ?: "Request failed" }.isSuccess

private fun today() = LocalDate.now().toString()

// The capture buttons of the Travel list and of a trip: Take photo across the width, Photo and PDF / file below it.
@Composable
private fun CaptureRow(attach: Attach) {
    Column(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), verticalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        Button("Take photo", attach.takePhoto, Modifier.fillMaxWidth(), variant = ButtonVariant.Filled, icon = "device-camera", fill = true)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
            Button("Photo", attach.choosePhoto, Modifier.weight(1f), icon = "file-media", fill = true)
            Button("PDF / file", attach.chooseFile, Modifier.weight(1f), icon = "file", fill = true)
        }
    }
}

// Travel (web/src/travel/Travel.tsx): work trips, their receipts as photos or PDFs that Claude reads, notes and totals.
@Composable
fun TravelScreen(hub: Hub, onBack: () -> Unit) {
    var tick by remember { mutableIntStateOf(0) }
    val (load, reload) = rememberLoad(tick) { parseTravel(hub.api.get("/api/travel")) }
    val data = load.data
    val reading = data?.receipts?.any { it.read == "pending" } == true
    LaunchedEffect(reading) { while (reading) { delay(POLL_MS); reload() } }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    var finding by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val find = {
        finding = true
        scope.launch {
            var found: ScanResult? = null
            if (hub.travelWrite { found = parseScan(api.post("/api/travel/scan", "{}")) }) { found?.let { hub.notice.value = scanText(it.added, it.updated) }; reload() }
            finding = false
        }
        Unit
    }
    val trip = data?.trips?.firstOrNull { it.id == open }
    if (trip != null) {
        TripView(hub, trip, data.receipts.filter { it.tripId == trip.id }, onBack = { open = null }, reload = reload)
        return
    }
    var all by rememberSaveable { mutableStateOf(false) }
    var filing by remember { mutableIntStateOf(0) }
    val attach = rememberAttach(hub, { filing += it }, send = { name, mime, bytes ->
        if (hub.readOnly) { hub.notice.value = READ_ONLY_SENT; null }
        else runCatching { hub.api.postBytes("/api/travel/receipt?name=${enc(name)}", mime, bytes, slow = true) }
            .onFailure { hub.notice.value = "Receipt not added: ${it.message}" }.getOrNull()
    }) { body ->
        val r = protocolJson.decodeFromString(Receipt.serializer(), body)
        hub.notice.value = "Added to ${data?.trips?.firstOrNull { it.id == r.tripId }?.name ?: "a trip"}${if (r.read == "failed") ", could not read it" else ""}"
        reload()
    }
    Column(Modifier.fillMaxSize()) {
        PageHeader("Travel", onBack) {
            IconBtn("calendar", if (finding) "Reading calendar" else "Find in calendar", find, enabled = !finding)
            IconBtn("add", "New trip", { adding = true })
        }
        Box(Modifier.fillMaxSize().background(av.groupPage)) {
            when {
                data == null && load.error.isNotEmpty() -> EmptyState("Could not load trips", load.error, icon = "briefcase", action = { Button("Retry", reload, size = ButtonSize.Sm) })
                data == null -> Loading("Loading trips…")
                data.trips.isEmpty() -> EmptyState("No trips yet", "Find your trips in the calendar, or add one, then its receipts, bookings and notes", icon = "briefcase", action = { Button(if (finding) "Reading calendar…" else "Find in calendar", find, size = ButtonSize.Sm, enabled = !finding) })
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    val sorted = sortTrips(data.trips, today())
                    CaptureRow(attach)
                    if (filing > 0) Group { ListRow("Adding ${plural(filing, "receipt")}…", leading = { AvIcon("loading") }) }
                    SectionHeader("Trips", sorted.size.toString())
                    Group {
                        sorted.take(if (all) sorted.size else FOLD).forEachIndexed { i, t ->
                            if (i > 0) Hairline(lead = true)
                            ListRow(t.name, tripMeta(t, data.receipts.filter { it.tripId == t.id }, today()), leading = { AvIcon("briefcase") }, onClick = { open = t.id })
                        }
                    }
                    if (!all && sorted.size > FOLD) Button("Show all ${sorted.size}", { all = true }, Modifier.padding(horizontal = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                    Spacer(Modifier.padding(bottom = Tokens.sp16))
                }
            }
        }
    }
    if (adding) TripSheet(hub, null, onDismiss = { adding = false }) { id -> adding = false; open = id; tick++ }
}

@Composable
private fun TripView(hub: Hub, trip: Trip, receipts: List<Receipt>, onBack: () -> Unit, reload: () -> Unit) {
    BackHandler(onBack = onBack)
    val ctx = LocalContext.current
    val clip = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var uploading by remember { mutableIntStateOf(0) }
    var editing by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var openId by remember { mutableStateOf<String?>(null) }
    var itemSheet by remember { mutableStateOf<PlanItem?>(null) }
    var addingItem by remember { mutableStateOf(false) }
    var all by rememberSaveable(trip.id) { mutableStateOf(false) }
    val sorted = receipts.sortedByDescending { it.addedAt }
    val attach = rememberAttach(hub, { uploading += it }, send = { name, mime, bytes ->
        if (hub.readOnly) { hub.notice.value = READ_ONLY_SENT; null }
        else runCatching { hub.api.postBytes("/api/travel/receipt?trip=${enc(trip.id)}&name=${enc(name)}", mime, bytes) }
            .onFailure { hub.notice.value = "Could not add $name: ${it.message}" }.getOrNull()
    }) { reload() }
    val view = { path: String -> runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(hub.api.link(path)))) }.onFailure { hub.notice.value = "No app to open it" } }
    val summary = { (listOf("${trip.name} (${tripDates(trip)})") + sorted.map { "- ${receiptMeta(it)} ${it.merchant}".trim() } + "Total: ${totalsText(receipts).ifEmpty { "none" }}").joinToString("\n") }
    Column(Modifier.fillMaxSize()) {
        PageHeader(trip.name, onBack, subtitle = tripDates(trip).takeIf { it.isNotEmpty() }?.let { dates -> { TripSubtitle(trip, dates) } }) {
            MoreButton { close ->
                MenuItem("Edit trip", "edit", { close(); editing = true })
                MenuItem("Export receipts (CSV)", "cloud-download", { close(); view("/api/travel/export?trip=${enc(trip.id)}") })
                MenuItem("Copy summary", "copy", { close(); clip.setText(AnnotatedString(summary())); hub.notice.value = "Summary copied" })
                MenuItem("Delete trip", "trash", { close(); deleting = true }, danger = true)
            }
        }
        Column(Modifier.fillMaxSize().background(av.groupPage).verticalScroll(rememberScrollState())) {
            CaptureRow(attach)
            Itinerary(trip, onAdd = { addingItem = true }, onOpen = { itemSheet = it })
            SectionHeader("Receipts", receipts.size.takeIf { it > 0 }?.toString())
            if (receipts.isEmpty() && uploading == 0) EmptyState("No receipts yet", "Take a photo or add a PDF; Claude fills in the amount", icon = "file-media")
            else Group {
                if (uploading > 0) ListRow("Uploading $uploading…", leading = { AvIcon("loading") })
                sorted.take(if (all) sorted.size else FOLD).forEachIndexed { i, r ->
                    if (i > 0 || uploading > 0) Hairline(lead = true)
                    ListRow(r.merchant.ifEmpty { r.name }, receiptMeta(r), leading = { Thumb(hub, r) }, onClick = { openId = r.id })
                }
            }
            if (!all && sorted.size > FOLD) Button("Show all ${sorted.size}", { all = true }, Modifier.padding(horizontal = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
            if (receipts.isNotEmpty()) Text("Total ${totalsText(receipts).ifEmpty { "none yet" }}", Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), style = Type.headline, color = av.fg)
            Notes(hub, trip, reload)
            Spacer(Modifier.padding(bottom = Tokens.sp16))
        }
    }
    sorted.firstOrNull { it.id == openId }?.let { r ->
        ReceiptSheet(hub, r, onOpen = { view("/api/travel/file?id=${enc(r.id)}") }, onDismiss = { openId = null }, onSaved = reload)
    }
    if (addingItem) PlanItemSheet(hub, trip, null, today(), onDismiss = { addingItem = false }, onSaved = reload)
    itemSheet?.let { i -> PlanItemSheet(hub, trip, i, today(), onDismiss = { itemSheet = null }, onSaved = reload) }
    if (editing) TripSheet(hub, trip, onDismiss = { editing = false }) { editing = false; reload() }
    if (deleting) ConfirmDialog("Delete ${trip.name}?", "Its receipts and their files are deleted too.", "Delete", {
        deleting = false
        scope.launch { if (hub.travelWrite { api.post("/api/travel/trip/delete", idJson(trip.id)) }) { onBack(); reload() } }
    }, onDismiss = { deleting = false })
}

// The dates and state under the trip name; only "Now" is styled, after a dot.
@Composable
private fun TripSubtitle(trip: Trip, dates: String) {
    val day = today()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("$dates · ")
        if (tripState(trip, day) == "now") {
            Box(Modifier.size(6.dp).background(av.accentFill, CircleShape))
            Spacer(Modifier.width(Tokens.sp2))
            Text(tripStateText(trip, day), color = av.accentFill)
        } else Text(tripStateText(trip, day))
    }
}

@Composable
private fun Itinerary(trip: Trip, onAdd: () -> Unit, onOpen: (PlanItem) -> Unit) {
    val day = today()
    val next = if (tripState(trip, day) == "now") nextItem(trip.plan, LocalDateTime.now().format(NOW)) else null
    SectionHeader("Itinerary", trip.plan.size.takeIf { it > 0 }?.toString(), action = { Button("Add item", onAdd, size = ButtonSize.Sm, icon = "add") })
    if (trip.plan.isEmpty()) EmptyState("No plan yet", "Find in calendar fills it in, or add an item", icon = "calendar")
    groupPlan(trip.plan).forEach { g ->
        SectionHeader(dayLabel(g.day, day))
        Group {
            g.items.forEachIndexed { i, item ->
                if (i > 0) Hairline()
                val title = if (item === next) buildAnnotatedString { withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(item.title) } } else item.title
                ListRow(title, itemMeta(item), leading = {
                    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.width(48.dp)) {
                            val tnum = TextStyle(fontFeatureSettings = "tnum")
                            if (item.start.isEmpty()) Text("All day", style = Type.meta.merge(tnum), color = av.fgMuted)
                            else Text(item.start, style = Type.body.merge(tnum), color = av.fg)
                            if (item.end.isNotEmpty()) Text(item.end, style = Type.meta.merge(tnum), color = av.fgMuted)
                        }
                        AvIcon(KIND_ICONS[item.kind] ?: "circle-filled")
                    }
                }, modifier = if (item === next) Modifier.background(av.hover) else Modifier, onClick = { onOpen(item) })
            }
        }
    }
}

private val NOW = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.ROOT)

@Composable
private fun Notes(hub: Hub, trip: Trip, reload: () -> Unit) {
    var text by rememberSaveable(trip.id, trip.notes) { mutableStateOf(trip.notes) }
    val scope = rememberCoroutineScope()
    val save = { scope.launch { if (hub.travelWrite { api.post("/api/travel/trip", tripJson(trip, notes = text)) }) { hub.notice.value = "Notes saved"; reload() } } }
    SectionHeader("Notes", action = if (text != trip.notes) ({ Button("Save", { save() }, size = ButtonSize.Sm, variant = ButtonVariant.Filled) }) else null)
    Group(Modifier.padding(horizontal = Tokens.listPad)) {
        TextField(text, { text = it }, Modifier.fillMaxWidth().padding(Tokens.sp4), placeholder = "Booking codes, addresses", minLines = 3)
    }
}

// A small picture of a photo receipt, or a file icon for a PDF.
@Composable
private fun Thumb(hub: Hub, r: Receipt) {
    val mod = Modifier.size(40.dp).clip(RoundedCornerShape(Tokens.sp2)).background(av.sunken)
    if (!isImage(r)) return Box(mod, contentAlignment = Alignment.Center) { AvIcon(if (r.mime == "application/pdf") "file-pdf" else "file") }
    val img by produceState<ImageBitmap?>(null, r.id) { value = receiptImage(hub, r.id, 160) }
    Box(mod) { img?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) } }
}

internal suspend fun receiptImage(hub: Hub, id: String, maxPx: Int): ImageBitmap? = withContext(Dispatchers.IO) {
    runCatching {
        val bytes = hub.api.bytes("/api/travel/file?id=${enc(id)}")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
    }.getOrNull()
}

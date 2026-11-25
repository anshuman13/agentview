package no.pradhan.agentview.nativeapp.travel

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.lifecycle.viewModelScope
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.askCodex
import no.pradhan.agentview.nativeapp.chat.Attach
import no.pradhan.agentview.nativeapp.chat.rememberAttach
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Card
import no.pradhan.agentview.nativeapp.ui.CardGrid
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
import no.pradhan.agentview.nativeapp.ui.motionOff
import no.pradhan.agentview.nativeapp.ui.plural
import no.pradhan.agentview.nativeapp.ui.rememberLoad

private const val FOLD = 5
private const val POLL_MS = 2500L

// A write to the Mac; false after a failure (shown as a notice) or in a read-only run.
internal suspend fun Hub.travelWrite(failure: String? = null, block: suspend Hub.() -> Unit): Boolean =
    if (readOnly) { notice.value = READ_ONLY_SENT; false }
    else runCatching { block() }.onFailure { notice.value = failure ?: it.message ?: "Request failed" }.isSuccess

private fun today() = LocalDate.now().toString()

// The capture actions of the Travel list and of a trip: a row of tiles, icon in a grey circle over the label.
@Composable
private fun CaptureRow(attach: Attach) {
    Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp4), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
        CaptureTile("Take photo", "device-camera", attach.takePhoto, Modifier.weight(1f))
        CaptureTile("Photo", "file-media", attach.choosePhoto, Modifier.weight(1f))
        CaptureTile("PDF / file", "file", attach.chooseFile, Modifier.weight(1f))
    }
}

@Composable
private fun CaptureTile(label: String, icon: String, onClick: () -> Unit, modifier: Modifier) {
    val shape = RoundedCornerShape(Tokens.shapeLg)
    Column(
        modifier.clip(shape).background(av.surface).border(Tokens.hairline, av.border, shape).clickable(role = Role.Button, onClick = onClick).padding(vertical = Tokens.sp6),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Tokens.sp3),
    ) {
        Box(Modifier.size(Tokens.controlMd).clip(CircleShape).background(av.sunken), contentAlignment = Alignment.Center) { AvIcon(icon, null, Tokens.icon, tint = av.accentText) }
        Text(label, style = Type.callout, color = av.onSurface, maxLines = 1)
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
    var archivedOpen by rememberSaveable { mutableStateOf(false) }
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
    val shown = open?.takeIf { id -> data?.trips?.any { it.id == id } == true }
    val listScroll = rememberScrollState()
    val still = motionOff()
    var all by rememberSaveable { mutableStateOf(false) }
    var filing by remember { mutableIntStateOf(0) }
    // With no trips the server refuses a receipt, so a picked file waits here until New trip is saved.
    var held by remember { mutableStateOf(emptyList<Triple<String, String, ByteArray>>()) }
    val post: suspend (String, String, String, ByteArray) -> String? = { tripId, name, mime, bytes ->
        runCatching { hub.api.postBytes("/api/travel/receipt?${if (tripId.isEmpty()) "" else "trip=${enc(tripId)}&"}name=${enc(name)}", mime, bytes, slow = true) }
            .onFailure { hub.notice.value = "Receipt not added: ${it.message}" }.getOrNull()
    }
    val added = { body: String ->
        val r = protocolJson.decodeFromString(Receipt.serializer(), body)
        hub.notice.value = "Added to ${data?.trips?.firstOrNull { it.id == r.tripId }?.name ?: "the trip"}${if (r.read == "failed") ", could not read it" else ""}"
        reload()
    }
    val attach = rememberAttach(hub, { filing += it }, send = { name, mime, bytes ->
        if (hub.readOnly) { hub.notice.value = READ_ONLY_SENT; null }
        else if (data?.trips?.isEmpty() == true) { held = held + Triple(name, mime, bytes); adding = true; null }
        else post("", name, mime, bytes)
    }, scan = true, onPath = added)
    val saved = { id: String ->
        adding = false; open = id; tick++
        val files = held
        held = emptyList()
        files.forEach { (name, mime, bytes) ->
            filing++
            hub.viewModelScope.launch { try { post(id, name, mime, bytes)?.let(added) } finally { filing-- } }
        }
    }
    // The trip pushes in from the right over the list and slides back out on back, like McpScreen.
    AnimatedContent(shown, Modifier.fillMaxSize(), transitionSpec = {
        val ease = if (targetState != null) Tokens.motionEaseIn else Tokens.motionEaseOut
        val slide = tween<IntOffset>(Tokens.motionDuration, easing = ease)
        val fade = tween<Float>(Tokens.motionDuration, easing = ease)
        (if (still) EnterTransition.None togetherWith ExitTransition.None
        else if (targetState != null) (slideInHorizontally(slide) { it } + fadeIn(fade)) togetherWith fadeOut(fade)
        else fadeIn(fade) togetherWith (slideOutHorizontally(slide) { it } + fadeOut(fade)))
            .apply { targetContentZIndex = if (targetState != null) 1f else -1f }
    }, label = "trip") { key ->
    val trip = data?.trips?.firstOrNull { it.id == key }
    if (trip != null) TripView(hub, trip, data.receipts.filter { it.tripId == trip.id }, data.home, onBack = { open = null }, reload = reload)
    else Column(Modifier.fillMaxSize()) {
        // With no trips the empty state carries Find in calendar and New trip, so the header leaves them out.
        PageHeader("Travel", onBack) {
            if (data?.trips?.isEmpty() != true) {
                IconBtn("calendar", if (finding) "Reading calendar" else "Find in calendar", find, enabled = !finding)
                IconBtn("add", "New trip", { adding = true })
            }
        }
        Box(Modifier.fillMaxSize().background(av.groupPage)) {
            when {
                data == null && load.error.isNotEmpty() -> EmptyState("Could not load trips", load.error, icon = "briefcase", action = { Button("Retry", reload, size = ButtonSize.Sm) })
                data == null -> Loading("Loading trips…")
                data.trips.isEmpty() -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    EmptyState("No trips yet. Add one, or start with a receipt", icon = "briefcase", action = {
                        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.sp4)) {
                            Button(if (finding) "Reading calendar…" else "Find in calendar", find, size = ButtonSize.Sm, enabled = !finding)
                            Button("New trip", { adding = true }, size = ButtonSize.Sm, icon = "add")
                        }
                    })
                    CaptureRow(attach)
                }
                else -> Column(Modifier.fillMaxSize().verticalScroll(listScroll)) {
                    val day = today()
                    val (active, archived) = splitTrips(data.trips, day)
                    val card = @Composable { t: Trip -> TripCardView(hub, t, tripCard(t, data.receipts.filter { it.tripId == t.id }, day)) { open = t.id } }
                    CaptureRow(attach)
                    if (filing > 0) Group { ListRow("Adding ${plural(filing, "receipt")}…", leading = { AvIcon("loading") }) }
                    SectionHeader("Trips", active.size.takeIf { it > 0 }?.toString())
                    if (active.isEmpty()) EmptyState("No upcoming trips", "Find in calendar or New trip adds one", icon = "briefcase")
                    else {
                        CardGrid(active.take(if (all) active.size else FOLD), Modifier.padding(horizontal = Tokens.listPad), card = card)
                        if (!all && active.size > FOLD) Button("Show all ${active.size}", { all = true }, Modifier.padding(horizontal = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                    }
                    if (archived.isNotEmpty()) {
                        SectionHeader("Archived", archived.size.toString(), archivedOpen, { archivedOpen = !archivedOpen })
                        if (archivedOpen) CardGrid(archived, Modifier.padding(horizontal = Tokens.listPad), card = card)
                    }
                    Spacer(Modifier.padding(bottom = Tokens.sp16))
                }
            }
        }
    }
    }
    if (adding) TripSheet(hub, null, onDismiss = { adding = false; held = emptyList() }, onSaved = saved)
}

@Composable
private fun TripView(hub: Hub, trip: Trip, receipts: List<Receipt>, home: String, onBack: () -> Unit, reload: () -> Unit) {
    BackHandler(onBack = onBack)
    val ctx = LocalContext.current
    val clip = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var uploading by remember { mutableIntStateOf(0) }
    var editing by remember { mutableStateOf(false) }
    var homing by remember { mutableStateOf(false) }
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
    }, scan = true) { reload() }
    val view = { path: String -> runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(hub.api.link(path)))) }.onFailure { hub.notice.value = "No app to open it" } }
    val summary = { (listOf("${trip.name} (${tripDates(trip)})") + sorted.map { "- ${receiptMeta(it)} ${it.merchant}".trim() } + "Total: ${totalsText(receipts).ifEmpty { "none" }}").joinToString("\n") }
    Column(Modifier.fillMaxSize()) {
        PageHeader(trip.name, onBack, subtitle = tripDates(trip).takeIf { it.isNotEmpty() }?.let { dates -> { TripSubtitle(trip, dates) } }) {
            MoreButton { close ->
                if (!hub.readOnly) MenuItem("Ask Claude", "sparkle", { close(); hub.askCodex(tripAsk(trip, receipts, home), if (tripKind(trip) == "work") "work" else "personal") })
                if (!hub.readOnly) MenuItem("Home address", "home", { close(); homing = true })
                MenuItem("Edit trip", "edit", { close(); editing = true })
                MenuItem("Export receipts (CSV)", "cloud-download", { close(); view("/api/travel/export?trip=${enc(trip.id)}") })
                MenuItem("Copy summary", "copy", { close(); clip.setText(AnnotatedString(summary())); hub.notice.value = "Summary copied" })
                MenuItem("Delete trip", "trash", { close(); deleting = true }, danger = true)
            }
        }
        Column(Modifier.fillMaxSize().background(av.groupPage).verticalScroll(rememberScrollState())) {
            CaptureRow(attach)
            Itinerary(trip, onAdd = { addingItem = true }, onOpen = { itemSheet = it })
            Checklist(hub, trip)
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
    if (homing) HomeSheet(hub, home, onDismiss = { homing = false }, onSaved = reload)
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
            Text(tripStateText(trip, day), color = av.accentText)
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

// The count is the open items; a tap flips the row at once and back when the save fails.
@Composable
private fun Checklist(hub: Hub, trip: Trip) {
    var flipped by remember(trip.checklist) { mutableStateOf(emptyMap<String, Boolean>()) }
    val items = trip.checklist.map { it.copy(done = flipped[it.id] ?: it.done) }
    val scope = rememberCoroutineScope()
    if (items.isEmpty()) return
    SectionHeader("Checklist", items.count { !it.done }.takeIf { it > 0 }?.toString())
    Group {
        items.forEachIndexed { i, c ->
            if (i > 0) Hairline(lead = true)
            ListRow(c.text, leading = { AvIcon(if (c.done) "check" else "circle-outline") }, strike = c.done, modifier = Modifier.semantics { stateDescription = if (c.done) "Done" else "Not done" }, onClick = if (hub.readOnly) null else ({
                flipped = flipped + (c.id to !c.done)
                scope.launch { if (!hub.travelWrite("Could not save the checklist") { api.post("/api/travel/check", checkJson(trip.id, c.id, !c.done)) }) flipped = flipped + (c.id to c.done) }
            }))
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
// A trip as a hairline card (web .tv-card): first image receipt as cover, else a briefcase strip; state as a chip.
@Composable
private fun TripCardView(hub: Hub, t: Trip, c: TripCard, onClick: () -> Unit) {
    Card(t.name, meta = tripMeta(t, c), onClick = onClick, cover = {
        val img by produceState<ImageBitmap?>(null, c.cover) { value = if (c.cover.isEmpty()) null else receiptImage(hub, c.cover, 720) }
        img?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
            ?: Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { AvIcon("briefcase", tint = av.fgMuted, size = 28.dp) }
    }) {
        if (c.stateText.isNotEmpty()) {
            val now = c.state == "now"
            val shape = RoundedCornerShape(50)
            Text(c.stateText, style = Type.meta, color = if (now) av.accent else av.fgMuted,
                modifier = Modifier.padding(top = Tokens.sp2).clip(shape)
                    .then(if (now) Modifier.background(av.accent.copy(alpha = 0.14f)) else Modifier.border(Tokens.hairline, av.border, shape))
                    .padding(horizontal = Tokens.sp4, vertical = 1.dp))
        }
    }
}

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

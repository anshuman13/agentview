package no.pradhan.agentview.nativeapp.travel

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import no.pradhan.agentview.nativeapp.net.protocolJson

// shared/travel.ts: work trips and their receipts, kept by the Mac in ~/.agentview/travel.
val CATEGORIES = listOf("Flight", "Train", "Taxi", "Hotel", "Meal", "Other")

val PLAN_KINDS = listOf("flight", "train", "taxi", "hotel", "meal", "event", "other")
val KIND_ICONS = mapOf("flight" to "send", "train" to "arrow-right", "taxi" to "location", "hotel" to "home", "event" to "calendar", "meal" to "coffee", "other" to "circle-filled")

// day is YYYY-MM-DD; start and end are HH:MM wall-clock times, or empty.
@Serializable
data class PlanItem(
    val id: String = "",
    val day: String,
    val start: String = "",
    val end: String = "",
    val kind: String = "other",
    val title: String,
    val place: String = "",
    val ref: String = "",
)

@Serializable
data class CheckItem(val id: String, val text: String, val done: Boolean = false)

@Serializable
data class Trip(
    val id: String,
    val name: String,
    val from: String = "",
    val to: String = "",
    val notes: String = "",
    val plan: List<PlanItem> = emptyList(),
    val checklist: List<CheckItem> = emptyList(),
    val createdAt: Long = 0,
    val calendar: Boolean = false,
    val edited: Boolean = false,
)

@Serializable
data class Receipt(
    val id: String,
    val tripId: String,
    val file: String = "",
    val name: String = "",
    val mime: String = "",
    val merchant: String = "",
    val amount: Double? = null,
    val currency: String = "",
    val date: String = "",
    val category: String = "Other",
    val note: String = "",
    val read: String = "done",
    val addedAt: Long = 0,
)

@Serializable
data class TravelData(val trips: List<Trip> = emptyList(), val receipts: List<Receipt> = emptyList(), val home: String = "")

fun parseTravel(body: String): TravelData = protocolJson.decodeFromString(TravelData.serializer(), body)

fun formatAmount(n: Double): String = String.format(Locale.ROOT, "%.2f", n).removeSuffix(".00")

data class Total(val currency: String, val sum: Double)

// The sum per currency, largest first, skipping receipts without an amount.
fun totals(receipts: List<Receipt>): List<Total> = receipts.filter { it.amount != null }
    .groupBy { it.currency.ifEmpty { "?" } }
    .map { (cur, rs) -> Total(cur, Math.round(rs.sumOf { it.amount!! } * 100) / 100.0) }
    .sortedByDescending { it.sum }

fun totalsText(receipts: List<Receipt>) = totals(receipts).joinToString(" + ") { "${formatAmount(it.sum)} ${it.currency}" }

private fun end(t: Trip) = t.to.ifEmpty { t.from }

// "now" when today is inside the trip, "upcoming" before it, "past" after it, "" without dates.
fun tripState(t: Trip, today: String) = when {
    t.from.isEmpty() -> ""
    t.from <= today && today <= end(t) -> "now"
    t.from > today -> "upcoming"
    else -> "past"
}

fun tripStateText(t: Trip, today: String): String = when (val s = tripState(t, today)) {
    "now" -> "Now"
    "past" -> "Past"
    "upcoming" -> LocalDate.parse(t.from).toEpochDay().minus(LocalDate.parse(today).toEpochDay()).let { if (it == 1L) "In 1 day" else "In $it days" }
    else -> s
}

// Trips with today inside their dates first, then upcoming by start, then past by end, newest first, undated last.
fun sortTrips(trips: List<Trip>, today: String): List<Trip> {
    fun rank(t: Trip) = listOf("now", "upcoming", "past", "").indexOf(tripState(t, today))
    return trips.sortedWith { a, b ->
        val r = rank(a) - rank(b)
        if (r != 0) r else if (rank(a) == 2) end(b).compareTo(end(a)) else if (rank(a) == 3) 0 else a.from.compareTo(b.from)
    }
}

data class TripSplit(val active: List<Trip>, val archived: List<Trip>)

// The sorted trips split into active (now, upcoming, undated) and archived (past, newest end first).
fun splitTrips(trips: List<Trip>, today: String): TripSplit {
    val (archived, active) = sortTrips(trips, today).partition { tripState(it, today) == "past" }
    return TripSplit(active, archived)
}

private val BY_TIME = compareBy<PlanItem>({ it.day }, { it.start })

class PlanDay(val day: String, val items: List<PlanItem>)

// One entry per day with items, in day order.
fun groupPlan(plan: List<PlanItem>): List<PlanDay> = plan.sortedWith(BY_TIME).groupBy { it.day }.map { (day, items) -> PlanDay(day, items) }

// The first timed item still to come at now ("YYYY-MM-DD HH:MM", local): its end, or its start without one, is after now.
fun nextItem(plan: List<PlanItem>, now: String): PlanItem? = plan.sortedWith(BY_TIME).firstOrNull {
    val day = if (it.end.isNotEmpty() && it.end < it.start) LocalDate.parse(it.day).plusDays(1).toString() else it.day
    it.start.isNotEmpty() && "$day ${it.end.ifEmpty { it.start }}" > now
}

// The trip a receipt dated date belongs to: the one covering it, else the Now trip, else the nearest by dates.
fun fileTrip(trips: List<Trip>, date: String, today: String): Trip? {
    val dated = sortTrips(trips, today).filter { it.from.isNotEmpty() }
    if (dated.isEmpty()) return trips.firstOrNull()
    val d = LocalDate.parse(date.ifEmpty { today }).toEpochDay()
    fun gap(t: Trip) = maxOf(LocalDate.parse(t.from).toEpochDay() - d, d - LocalDate.parse(end(t)).toEpochDay(), 0L)
    return dated.firstOrNull { gap(it) == 0L } ?: dated.firstOrNull { tripState(it, today) == "now" }
        ?: dated.reduce { best, t -> if (gap(t) < gap(best) || (gap(t) == gap(best) && t.from < best.from)) t else best }
}

private val SHORT = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
private val SHORT_DAY = DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())
private fun short(d: String) = runCatching { LocalDate.parse(d).format(SHORT) }.getOrDefault(d)

fun dayLabel(day: String, today: String) = runCatching { LocalDate.parse(day).format(SHORT_DAY) }.getOrDefault(day) + if (day == today) " · Today" else ""

fun itemMeta(i: PlanItem) = listOf(i.ref, i.place).filter { it.isNotEmpty() }.joinToString(" · ")

fun tripDates(t: Trip): String = when {
    t.from.isEmpty() -> ""
    t.to.isEmpty() || t.to == t.from -> short(t.from)
    else -> "${short(t.from)} to ${short(t.to)}"
}

fun tripMeta(t: Trip, receipts: List<Receipt>, today: String): String = listOf(
    tripDates(t),
    tripStateText(t, today),
    if (receipts.isEmpty()) "" else "${receipts.size} receipt${if (receipts.size == 1) "" else "s"}",
    totalsText(receipts),
    if (t.calendar) "From calendar" else "",
).filter { it.isNotEmpty() }.joinToString(" · ")

fun receiptMeta(r: Receipt): String {
    if (r.read == "pending") return "Reading…"
    val amount = r.amount?.let { "${formatAmount(it)} ${r.currency}" } ?: if (r.read == "failed") "Could not read, add the amount" else "No amount"
    return listOf(if (r.date.isEmpty()) "" else short(r.date), r.category, amount).filter { it.isNotEmpty() }.joinToString(" · ")
}

fun isImage(r: Receipt) = r.mime.startsWith("image/") && r.mime != "image/heic"

@Serializable
data class ScanResult(val added: Int = 0, val updated: Int = 0)

fun parseScan(body: String): ScanResult = protocolJson.decodeFromString(ScanResult.serializer(), body)

private fun count(n: Int) = "$n trip${if (n == 1) "" else "s"}"

// shared/travel.ts scanText: what Find in calendar did.
fun scanText(added: Int, updated: Int): String {
    if (added == 0 && updated == 0) return "No new trips in the calendar"
    return listOf(
        if (added > 0) "Added ${count(added)}" else "",
        if (updated > 0) "${if (added > 0) "updated" else "Updated"} ${count(updated)}" else "",
    ).filter { it.isNotEmpty() }.joinToString(", ")
}

// The checklist items with text, ids repaired, text on one line, the first 100.
fun cleanChecklist(raw: JsonElement?, newId: () -> String): List<CheckItem> {
    if (raw !is JsonArray) return emptyList()
    val seen = mutableSetOf<String>()
    return raw.mapNotNull { r ->
        val o = r as? JsonObject
        val text = (o?.get("text") as? JsonPrimitive)?.takeIf { it.isString }?.content?.replace(Regex("\\s*[\\r\\n]+\\s*"), " ")?.trim()?.take(200)
        if (text.isNullOrEmpty()) return@mapNotNull null
        val given = (o?.get("id") as? JsonPrimitive)?.takeIf { it.isString }?.content
        val id = if (!given.isNullOrEmpty() && given !in seen) given else newId()
        seen += id
        val done = (o?.get("done") as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true
        CheckItem(id, text, done)
    }.take(100)
}

val WORK_WORDS = listOf("conference", "meeting", "offsite", "workshop", "training", "summit", "talk", "keynote", "customer", "client")

// "work" when the trip name or an event title holds a whole work word, else "leisure".
fun tripKind(t: Trip): String {
    val titles = listOf(t.name) + t.plan.filter { it.kind == "event" }.map { it.title }
    return if (titles.any { title -> title.lowercase().split(Regex("[^\\p{L}]+")).any { it in WORK_WORDS } }) "work" else "leisure"
}

private fun tripRange(t: Trip) = when {
    t.from.isEmpty() -> "no dates"
    t.to.isEmpty() || t.to == t.from -> t.from
    else -> "${t.from} to ${t.to}"
}

// The trip as plain lines for Claude: itinerary, checklist, receipts and notes, each left out when empty. Ids are in brackets.
fun tripText(t: Trip, receipts: List<Receipt>): String {
    val lines = mutableListOf("Trip ${t.id}: ${t.name}, ${tripRange(t)}")
    if (t.plan.isNotEmpty()) {
        lines += "Itinerary:"
        groupPlan(t.plan).forEach { g ->
            lines += g.day
            g.items.forEach { i ->
                val time = if (i.start.isEmpty()) "" else "${i.start}${if (i.end.isEmpty()) "" else "-${i.end}"} "
                lines += "- $time${i.kind}: ${listOf(i.title, i.place, i.ref).filter { it.isNotEmpty() }.joinToString(" · ")} [${i.id}]"
            }
        }
    }
    if (t.checklist.isNotEmpty()) {
        lines += "Checklist:"
        t.checklist.forEach { lines += "- [${if (it.done) "x" else " "}] ${it.text} [${it.id}]" }
    }
    if (receipts.isNotEmpty()) {
        lines += "Receipts (${totalsText(receipts).ifEmpty { "no amounts" }}):"
        receipts.sortedBy { it.date.ifEmpty { "9" } }.forEach { r ->
            lines += "- ${r.date.ifEmpty { "no date" }} ${r.merchant.ifEmpty { r.name }} ${r.amount?.let { "${formatAmount(it)} ${r.currency}" } ?: "no amount"}"
        }
    }
    if (t.notes.isNotEmpty()) lines += listOf("Notes:", t.notes)
    return lines.joinToString("\n")
}

// The prompt that asks Claude for a pre-trip brief. home is the user's start address, or empty when it is not set.
fun tripAsk(t: Trip, receipts: List<Receipt>, home: String): String = listOf(
    "Give me a short, practical brief for this trip. Check with your calendar, files and web tools rather than guess, and keep it tight.",
    "1. Getting there: for each outbound flight or train, when to leave home to reach the airport or station, with public transport and taxi options, travel times and buffer for check-in and security; then from the arrival airport or station to the hotel; then the trip back home.",
    "2. Readiness: for work events and talks, ask whether the deck or material is ready and offer to find it in my files, Drive or the calendar event and help finish it. Check-in reminders, passport and boarding passes, a hotel booked for every night, gaps in the plan.",
    "3. A short packing and weather note for the destination and dates.",
    "4. A checklist of open items at the end.",
    "When I tell you something worth keeping (a time to leave, a booking code, a taxi booked, the deck is done), note it on the trip at once with mcp__agentview__travel, and add or tick checklist items as things get done. The trip page shows them.",
    "This looks like a ${tripKind(t)} trip.",
    if (home.isNotEmpty()) "Home: $home" else "My start address is unknown: ask me for it and save it with mcp__agentview__travel (action home).",
    "",
    tripText(t, receipts),
).joinToString("\n")

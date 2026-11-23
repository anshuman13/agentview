package no.pradhan.agentview.nativeapp.travel

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.serialization.Serializable
import no.pradhan.agentview.nativeapp.net.protocolJson

// shared/travel.ts: work trips and their receipts, kept by the Mac in ~/.agentview/travel.
val CATEGORIES = listOf("Flight", "Train", "Taxi", "Hotel", "Meal", "Other")

@Serializable
data class Trip(
    val id: String,
    val name: String,
    val from: String = "",
    val to: String = "",
    val notes: String = "",
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
data class TravelData(val trips: List<Trip> = emptyList(), val receipts: List<Receipt> = emptyList())

fun parseTravel(body: String): TravelData = protocolJson.decodeFromString(TravelData.serializer(), body)

fun formatAmount(n: Double): String = String.format(Locale.ROOT, "%.2f", n).removeSuffix(".00")

data class Total(val currency: String, val sum: Double)

// The sum per currency, largest first, skipping receipts without an amount.
fun totals(receipts: List<Receipt>): List<Total> = receipts.filter { it.amount != null }
    .groupBy { it.currency.ifEmpty { "?" } }
    .map { (cur, rs) -> Total(cur, Math.round(rs.sumOf { it.amount!! } * 100) / 100.0) }
    .sortedByDescending { it.sum }

fun totalsText(receipts: List<Receipt>) = totals(receipts).joinToString(" + ") { "${formatAmount(it.sum)} ${it.currency}" }

// Trips with today inside their dates first, then upcoming by start, then past by end, newest first.
fun sortTrips(trips: List<Trip>, today: String): List<Trip> {
    fun end(t: Trip) = t.to.ifEmpty { t.from }
    fun rank(t: Trip) = if (t.from <= today && today <= end(t)) 0 else if (t.from > today) 1 else 2
    return trips.sortedWith { a, b ->
        val r = rank(a) - rank(b)
        if (r != 0) r else if (rank(a) == 2) end(b).compareTo(end(a)) else a.from.compareTo(b.from)
    }
}

private val SHORT = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
private fun short(d: String) = runCatching { LocalDate.parse(d).format(SHORT) }.getOrDefault(d)

fun tripDates(t: Trip): String = when {
    t.from.isEmpty() -> ""
    t.to.isEmpty() || t.to == t.from -> short(t.from)
    else -> "${short(t.from)} to ${short(t.to)}"
}

fun tripMeta(t: Trip, receipts: List<Receipt>): String = listOf(
    tripDates(t),
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

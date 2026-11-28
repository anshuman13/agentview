package no.pradhan.agentview.nativeapp.net

import kotlinx.serialization.Serializable

// Mirrors shared/prices.ts; shared/fixtures/prices.json keeps the two equal.
// input excludes cachedInput, and reasoning is already inside output, so it is never billed again.
@Serializable
data class TurnTokens(
    val model: String,
    val input: Long = 0,
    val cachedInput: Long = 0,
    val cacheWrite: Long = 0,
    val output: Long = 0,
    val reasoning: Long = 0,
)

@Serializable
data class Price(val input: Double, val cachedInput: Double, val cacheWrite: Double, val output: Double)

// $ per million tokens, keyed by model id prefix; the longest matching prefix wins.
val PRICES: Map<String, Price> = mapOf(
    "claude-fable-5-2" to Price(8.0, 0.2, 10.0, 40.0),
    "claude-fable-5" to Price(10.0, 1.0, 12.5, 50.0),
    "claude-mythos-5-2" to Price(8.0, 0.2, 10.0, 40.0),
    "claude-mythos-5" to Price(10.0, 1.0, 12.5, 50.0),
    "claude-opus-5-5" to Price(4.0, 0.2, 5.0, 20.0),
    "claude-opus-5" to Price(5.0, 0.5, 6.25, 25.0),
    "claude-opus-4-5" to Price(5.0, 0.5, 6.25, 25.0),
    "claude-opus-4-6" to Price(5.0, 0.5, 6.25, 25.0),
    "claude-opus-4-7" to Price(5.0, 0.5, 6.25, 25.0),
    "claude-opus-4-8" to Price(5.0, 0.5, 6.25, 25.0),
    "claude-opus-4" to Price(15.0, 1.5, 18.75, 75.0),
    "claude-sonnet-5-5" to Price(2.0, 0.1, 2.5, 10.0),
    "claude-sonnet-5" to Price(2.0, 0.2, 2.5, 10.0),
    "claude-sonnet-4" to Price(3.0, 0.3, 3.75, 15.0),
    "claude-haiku-5-5" to Price(0.1, 0.01, 0.125, 0.5),
    "claude-haiku-4-5" to Price(1.0, 0.1, 1.25, 5.0),
    "gpt-6.2-astra" to Price(8.0, 0.4, 10.0, 40.0),
    "gpt-6.2-sol" to Price(2.0, 0.1, 2.5, 10.0),
    "gpt-6.1-sol" to Price(2.0, 0.1, 2.5, 10.0),
    "gpt-6.1-terra" to Price(1.0, 0.05, 1.25, 5.0),
    "gpt-6-astra" to Price(10.0, 1.0, 12.5, 50.0),
    "gpt-6-sol" to Price(2.0, 0.2, 2.5, 10.0),
    "gpt-6-luna" to Price(0.1, 0.01, 0.125, 0.5),
    "gpt-5.6-sol" to Price(4.0, 0.4, 5.0, 20.0),
    "gpt-5.6-terra" to Price(2.0, 0.2, 2.5, 12.0),
    "gpt-5.6-luna" to Price(0.2, 0.02, 0.25, 1.2),
    "gpt-5.5" to Price(5.0, 0.5, 0.0, 30.0),
    "gpt-5.4-mini" to Price(0.75, 0.075, 0.0, 4.5),
    "gpt-5.4" to Price(2.5, 0.25, 0.0, 15.0),
    "gpt-5.2" to Price(1.75, 0.175, 0.0, 14.0),
    "gpt-5.1" to Price(1.25, 0.125, 0.0, 10.0),
    "gpt-5-mini" to Price(0.25, 0.025, 0.0, 2.0),
    "gpt-5" to Price(1.25, 0.125, 0.0, 10.0),
    "o3" to Price(2.0, 0.5, 0.0, 8.0),
)

fun priceOf(model: String): Price? {
    val id = model.lowercase()
    return PRICES.keys.filter { id.startsWith(it) }.maxByOrNull { it.length }?.let { PRICES[it] }
}

// Dollars for one turn, or null when the model has no price.
fun costOf(t: TurnTokens): Double? {
    val p = priceOf(t.model) ?: return null
    return (t.input * p.input + t.cachedInput * p.cachedInput + t.cacheWrite * p.cacheWrite + t.output * p.output) / 1e6
}

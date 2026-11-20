package no.pradhan.agentview.nativeapp.chat

import no.pradhan.agentview.nativeapp.codex.Row
import no.pradhan.agentview.nativeapp.codex.wiki.RETIRE_AFTER
import no.pradhan.agentview.nativeapp.codex.wiki.givenPreferences
import no.pradhan.agentview.nativeapp.codex.wiki.restatedClaim
import no.pradhan.agentview.nativeapp.codex.wiki.shortDate
import no.pradhan.agentview.nativeapp.codex.wiki.similarClaim

data class MemoryMark(val mark: String, val claim: String)

// web chat/cards/memoryLogic.ts memoryMark: what the wiki says of a memory file (never an instruction file or MEMORY.md). Conflicts when it repeats
// a Memory claim the user rejected, else In wiki when a current Memory claim restates it, else Stale when it has not changed in RETIRE_AFTER.
fun memoryMark(file: MemoryFile, facts: List<Row>, profile: String, now: Long): MemoryMark? {
    if (!MEMORY_FILE.containsMatchIn(file.path) || isMemoryIndex(file.path)) return null
    val texts = listOf(file.description, file.text).filter { it.isNotEmpty() }
    val rejected = facts.filter { !it.deleted && it.str("state") == "rejected" && it.profile == profile && it.str("page_id").isNullOrEmpty() }
    for (t in texts) similarClaim(t, rejected) { it.str("text") ?: "" }?.let { return MemoryMark("Conflicts", it.str("text") ?: "") }
    for (t in texts) restatedClaim(t, facts, profile)?.let { return MemoryMark("In wiki", it.str("text") ?: "") }
    return if (file.at > 0 && now - file.at > RETIRE_AFTER) MemoryMark("Stale", "") else null
}

// web memoryLogic.ts memoryClaimText: the claim Move to wiki makes of a memory file, its description, else its body on one line, cut to the Remember limit.
fun memoryClaimText(file: MemoryFile) = file.description.trim().ifEmpty { file.text.replace(Regex("\\s+"), " ").trim() }.take(400)

// shared/preferences.ts leftOutPreferences: how many of the profile's claims chats would get on their own that the 15 or 1500 character limit leaves out.
fun leftOutPreferences(facts: List<Row>, profile: String, now: Long) =
    facts.count { givenPreferences(listOf(it), profile, now).isNotEmpty() } - givenPreferences(facts, profile, now).size

// The mark's long form under the file's title.
fun markLine(m: MemoryMark, at: Long, now: Long) = when (m.mark) {
    "Conflicts" -> "Similar to a claim you rejected: ${m.claim}"
    "In wiki" -> "Also in the wiki: ${m.claim}"
    else -> "Not changed since ${shortDate(at, now)}"
}

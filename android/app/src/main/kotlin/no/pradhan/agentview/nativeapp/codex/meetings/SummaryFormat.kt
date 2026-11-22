package no.pradhan.agentview.nativeapp.codex.meetings

import no.pradhan.agentview.nativeapp.codex.Row

// web/src/codex/data/meetings/summaryTemplates.ts; shared/fixtures/summary-template.json holds the texts and cases.
class SummaryTemplate(val label: String, val instructions: String)

val SUMMARY_TEMPLATES = linkedMapOf(
    "default" to SummaryTemplate("Default", ""),
    "one_on_one" to SummaryTemplate("1:1", "This was a 1:1. Summarize what we discussed about work, feedback, career and wellbeing, then the commitments each of us made and anything to raise next time."),
    "standup" to SummaryTemplate("Standup", "This was a standup. Summarize per person what was done, what is planned and what blocks them, and name the blockers that need follow-up."),
    "interview" to SummaryTemplate("Interview", "This was a job interview. Summarize the candidate background, strengths, concerns and notable answers, then the signals for and against hiring and the agreed next step."),
    "planning" to SummaryTemplate("Planning", "This was a planning meeting. Summarize the goals, the scope and priorities chosen, owners and dates, open risks and what was deferred."),
)

private val ONE_ON_ONE_RE = Regex("\\b1[:-]1\\b|\\b1on1\\b|\\bone[- ]on[- ]one\\b")
private val PAIR_RE = Regex("\\S\\s*/\\s*\\S")
private val STANDUP_RE = Regex("stand-?up|\\bdaily\\b")
private val PLANNING_RE = Regex("planning|\\bplan\\b")

// The template picked before for this series, else a guess from the title and guest count. Series is newest first.
fun templateFor(m: Row, series: List<Row>, picks: Map<String, String>): String {
    picks[notesPickKey(m)]?.takeIf { it in SUMMARY_TEMPLATES }?.let { return it }
    val title = (m.title ?: "").lowercase()
    val people = peopleOf(m).size.takeIf { it > 0 } ?: series.firstOrNull()?.let { peopleOf(it).size } ?: 0
    return when {
        ONE_ON_ONE_RE.containsMatchIn(title) || PAIR_RE.containsMatchIn(title) && people == 2 -> "one_on_one"
        STANDUP_RE.containsMatchIn(title) -> "standup"
        "interview" in title -> "interview"
        PLANNING_RE.containsMatchIn(title) -> "planning"
        people == 2 -> "one_on_one"
        else -> "default"
    }
}

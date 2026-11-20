package no.pradhan.agentview.nativeapp.codex.meetings

import org.junit.Assert.assertEquals
import org.junit.Test

class SeriesLogicTest {
    private fun chips(selected: String?) = NOTES_TEMPLATES.keys.map { NotesChip(it, it == selected) }

    @Test fun noneSelectedGivesStandup() = assertEquals("standup", nextNotesTemplate(chips(null)))

    @Test fun standupGivesDecision() = assertEquals("decision", nextNotesTemplate(chips("standup")))

    @Test fun decisionWrapsToOneOnOne() = assertEquals("one_on_one", nextNotesTemplate(chips("decision")))
}

package no.pradhan.agentview.nativeapp.app

import org.junit.Assert.assertEquals
import org.junit.Test

class MacsLogicTest {
    @Test fun listsTheMacInUseThenTheOthers() {
        val body = """{"hostname":"Odas-Mac-mini","urls":["http://100.1.1.1:7777"],"running":1,"macs":[{"name":"Anshumans-MacBook-Pro","url":"http://mbp.netbird.cloud:7777","running":2,"self":false},{"name":"x"}]}"""
        assertEquals(
            listOf(MacOption("Odas-Mac-mini", "http://100.1.1.1:7777", 1, true), MacOption("Anshumans-MacBook-Pro", "http://mbp.netbird.cloud:7777", 2, false)),
            parseMacs(body, "http://100.1.1.1:7777"),
        )
    }
}

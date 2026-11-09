package no.pradhan.agentview.nativeapp.workspace

import no.pradhan.agentview.nativeapp.net.protocolJson
import org.junit.Assert.assertEquals
import org.junit.Test

class DevServersTest {
    @Test fun decodesPortList() {
        val ports = protocolJson.decodeFromString<List<DevPort>>("""[{"port":5173,"name":"node","local":true},{"port":3000,"name":"bun","local":false}]""")
        assertEquals(listOf(5173, 3000), ports.map { it.port })
        assertEquals("node · localhost only, forwarded over NetBird", devPortMeta(ports[0]))
        assertEquals("bun", devPortMeta(ports[1]))
    }

    @Test fun decodesDevScript() {
        assertEquals("pnpm dev", protocolJson.decodeFromString<DevScript?>("""{"script":"dev","command":"pnpm dev"}""")?.command)
        assertEquals(null, protocolJson.decodeFromString<DevScript?>("null"))
    }
}

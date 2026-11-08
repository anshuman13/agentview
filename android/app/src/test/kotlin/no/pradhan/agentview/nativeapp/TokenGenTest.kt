package no.pradhan.agentview.nativeapp

import no.pradhan.agentview.tokens.TokenGen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class TokenGenTest {
    private val css = """
        /* comment { with braces } */
        :root { --sp-4: 8px; --fs-md: 13px; --list-pad: var(--sp-4); --hairline: 1px solid var(--border); --shadow-sm: 0 4px 16px rgba(0, 0, 0, 0.45); --lh: 1.5; --z-sheet: 50; }
        :root, :root[data-theme='dark'] { --bg: #000000; --border: rgba(84, 84, 88, 0.6); --accent-text: #409cff; }
        :root[data-theme='light'] { --bg: #ffffff; --border: #e5e5ea; --accent-text: #007aff; }
        :root { --accent-soft: color-mix(in srgb, var(--accent-text) 18%, transparent); --hover2: color-mix(in oklch, var(--bg) 50%, white);
          --type-body-size: var(--fs-md); --type-body-weight: 400; --type-body-line: var(--lh); }
        @media (pointer: coarse) { :root { --fs-md: 16px; } input { font-size: 16px !important; } }
        @media (max-width: 900px) { :root { --sp-4: 99px; } }
    """.trimIndent()

    @Test fun parsesBlocksAndMedia() {
        val blocks = TokenGen.parse(css)
        assertEquals(7, blocks.size)
        assertEquals(listOf(":root", ":root[data-theme='dark']"), blocks[1].selectors)
        assertEquals("(pointer: coarse)", blocks[4].media)
        assertEquals("16px", blocks[4].decls["fs-md"])
        assertEquals("rgba(84, 84, 88, 0.6)", blocks[1].decls["border"])
    }

    @Test fun themesCascadeAndTouchOverridesApply() {
        val blocks = TokenGen.parse(css)
        val light = TokenGen.vars(blocks, "light")
        val dark = TokenGen.vars(blocks, "dark")
        assertEquals("#ffffff", light["bg"])
        assertEquals("#000000", dark["bg"])
        assertEquals("16px", dark["fs-md"])
        assertEquals("8px", dark["sp-4"])
    }

    @Test fun resolvesVarChainsAndFallbacks() {
        val vars = mapOf("a" to "var(--b)", "b" to "4px")
        assertEquals("4px", TokenGen.resolve("var(--a)", vars))
        assertEquals("1px solid 4px", TokenGen.resolve("1px solid var(--a)", vars))
        assertEquals("2px", TokenGen.resolve("var(--missing, 2px)", vars))
        assertNull(TokenGen.resolve("var(--missing)", vars))
    }

    @Test fun readsColors() {
        assertEquals(0xFF409CFFL, TokenGen.color("#409cff"))
        assertEquals(0x99545458L, TokenGen.color("rgba(84, 84, 88, 0.6)"))
        assertEquals(0L, TokenGen.color("transparent"))
        assertEquals(0x2E0A84FFL, TokenGen.color("color-mix(in srgb, #0a84ff 18%, transparent)"))
        assertEquals(0xFF808080L, TokenGen.color("color-mix(in srgb, #ffffff 50%, #000000)"))
        assertNull(TokenGen.color("color-mix(in oklch, #fff 50%, #000)"))
        assertNull(TokenGen.color("none"))
    }

    @Test fun mapsScalesToUnits() {
        assertEquals("val sp4 = 8.dp", TokenGen.scale("sp-4", "8px"))
        assertEquals("val fsMd = 16.sp", TokenGen.scale("fs-md", "16px"))
        assertEquals("val hairline = 1.dp", TokenGen.scale("hairline", "1px solid #fff"))
        assertEquals("val shadowSm = 8.dp", TokenGen.scale("shadow-sm", "0 4px 16px rgba(0, 0, 0, 0.45)"))
        assertEquals("val stateHover = 0.08f", TokenGen.scale("state-hover", "8%"))
        assertEquals("const val dur = 120", TokenGen.scale("dur", "120ms"))
        assertEquals("val lhSnug = 1.4f", TokenGen.scale("lh-snug", "1.4"))
        assertNull(TokenGen.scale("z-sheet", "50"))
        assertNull(TokenGen.scale("safe-top", "0px"))
    }

    @Test fun generatesKotlin() {
        val out = TokenGen.generate(css, "x")
        assertTrue(out.contains("package x"))
        assertTrue(out.contains("    val bg: Color,"))
        assertTrue(out.contains("val DarkColors = AvColors(\n    bg = Color(0xFF111418),"))
        assertTrue(out.contains("    accentSoft = Color(0xFF3B4858),"))
        assertTrue(out.contains("    accentSoft = Color(0xFFD7E3F7),"))
        assertTrue(!out.contains("hover2"))
        assertTrue(out.contains("    val listPad = 8.dp"))
        assertTrue(out.contains("    val body = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight(400))"))
    }

    @Test fun nativeColorsOverrideBaseTokensAndFollowVar() {
        val out = TokenGen.generate(":root { --bg: #000000; --accent-text: #409cff; --link: var(--accent-text); --border: #123456; }", "x")
        val dark = out.substringAfter("val DarkColors").substringBefore("val LightColors")
        val light = out.substringAfter("val LightColors")
        assertTrue(dark.contains("    accentText = Color(0xFF9ECAFF),"))
        assertTrue(dark.contains("    link = Color(0xFF9ECAFF),"))
        assertTrue(light.contains("    link = Color(0xFF0061A4),"))
        assertTrue(dark.contains("    border = Color(0xFF42474E),"))
    }

    @Test fun addsDiffTints() {
        val out = TokenGen.generate(":root { --diff-add: #30d158; } :root[data-theme='light'] { --diff-add: #248a3d; }", "x")
        assertTrue(out.contains("    diffAddSoft = Color(0x1A30D158),"))
        assertTrue(out.contains("    diffAddSoft = Color(0x1A248A3D),"))
        assertTrue(!out.contains("diffDelSoft"))
    }

    @Test fun committedTokensMatchTheWeb() {
        val web = File("../../agentview/web/src/styles/tokens.css")
        if (!web.exists()) return
        val committed = File("src/main/kotlin/no/pradhan/agentview/nativeapp/Tokens.kt").readText()
        assertEquals("Run ./gradlew generateTokens", TokenGen.generate(web.readText(), "no.pradhan.agentview.nativeapp"), committed)
    }
}

package no.pradhan.agentview.nativeapp.chat

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// Same SDK, graphics mode and screen as ChatScreenshotTest, so both share one Robolectric sandbox. SDK 35 and up need Java 21.
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-hdpi")
class ChatClicksTest {
    @get:Rule val rule = createComposeRule()
    private val fx = ChatFixture()
    private val host = ChatHost(fx.hub)

    @Before fun open() {
        fx.show(finishedTurn())
        rule.setContent { host.Content() }
        rule.onNodeWithText("Used 3 tools").performClick()
    }

    @After fun close() = fx.close()

    @Test fun usedToolsOpensTheTurnsWorkScreen() {
        assertEquals("u0", host.work)
        rule.onNodeWithText("What Claude did").assertIsDisplayed()
        rule.onNodeWithText("Run the unit tests").assertIsDisplayed()
    }

    @Test fun aStepRowOpensItsCommandAndOutput() {
        rule.onNodeWithText("BUILD SUCCESSFUL in 4s").assertDoesNotExist()
        rule.onNodeWithText("Run the unit tests").performClick()
        rule.onNodeWithText("BUILD SUCCESSFUL in 4s").assertIsDisplayed()
    }

    @Test fun aFileRowOpensTheFileSheet() {
        val content = hasText("Hello, ", substring = true)
        rule.onNode(content).assertDoesNotExist()
        rule.onNodeWithText("Open").performClick()
        rule.waitUntilAtLeastOneExists(content, 5_000)
    }
}

package no.pradhan.agentview.nativeapp.chat

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// Checked against the images in src/test/screenshots; CLAUDE.md, Checks, says how to record them again.
@OptIn(ExperimentalRoborazziApi::class, ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-hdpi")
class ChatScreenshotTest {
    @get:Rule val rule = createComposeRule()
    private val fx = ChatFixture()
    private val host = ChatHost(fx.hub)

    @After fun close() = fx.close()

    private fun start() = rule.setContent { host.Content() }

    private fun snap(name: String) {
        for (theme in listOf("light", "dark")) {
            host.theme = theme
            rule.waitForIdle()
            captureScreenRoboImage("src/test/screenshots/chat_${name}_$theme.png")
        }
    }

    @Test fun empty() {
        fx.show(emptyList())
        start()
        rule.waitUntilAtLeastOneExists(hasText("No messages yet"))
        snap("empty")
    }

    @Test fun replyWithCodeAndEdits() {
        fx.show(finishedTurn())
        start()
        rule.waitUntilAtLeastOneExists(hasText("Used 3 tools"))
        snap("reply")
    }

    @Test fun runningTasksAndBuildHeader() {
        fx.show(runningTurn(), running = true, run = BUILD_RUN)
        start()
        rule.waitUntilAtLeastOneExists(hasText("Tasks · 2 of 3"))
        snap("running")
    }

    @Test fun longRunningStepStaysOnTheTaskLine() {
        fx.show(runningTurn(pattern = "a very long search pattern that cannot fit beside the task count"), running = true)
        start()
        rule.waitUntilAtLeastOneExists(hasText("Tasks · 2 of 3"))
        val tasks = rule.onNodeWithText("Tasks · 2 of 3").getUnclippedBoundsInRoot()
        val step = rule.onNodeWithText("Searching", substring = true).getUnclippedBoundsInRoot()
        assertEquals("$tasks", ((tasks.top + tasks.bottom) / 2).value, ((step.top + step.bottom) / 2).value, 4f)
    }

    @Test fun composerWithDraft() {
        fx.show(finishedTurn(), draft = "Add a test for the file sheet")
        start()
        rule.waitUntilAtLeastOneExists(hasText("Add a test for the file sheet"))
        snap("composer")
    }

    @Test fun stepsAndEditDiff() {
        fx.show(runningTurn(), running = true)
        start()
        rule.waitUntilAtLeastOneExists(hasText("Searching", substring = true))
        rule.onNodeWithText("Searching", substring = true).performClick()
        rule.onNodeWithText(EDITED.substringAfterLast('/')).performClick()
        rule.waitUntilAtLeastOneExists(hasText("// Greets by name.", substring = true))
        snap("steps")
    }

    @Test fun toolsSheet() {
        fx.show(finishedTurn())
        start()
        rule.onNodeWithContentDescription("More").performClick()
        rule.onNodeWithText("Tools…").performClick()
        rule.waitUntilAtLeastOneExists(hasText("Instruction and memory files"))
        snap("tools")
    }

    @Test fun fileSheet() {
        fx.show(finishedTurn())
        start()
        rule.onNodeWithText("Used 3 tools").performClick()
        rule.onNodeWithText("Open").performClick()
        rule.waitUntilAtLeastOneExists(hasText("Hello", substring = true), 5_000)
        snap("file")
    }
}

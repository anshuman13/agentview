package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureScreenRoboImage
import no.pradhan.agentview.nativeapp.codex.autopilot.taskTitle
import no.pradhan.agentview.nativeapp.ui.AgentViewTheme
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.av
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// The build chat's task line: the short title, then the full task after a tap; images in src/test/screenshots.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-hdpi")
class BuildHeadScreenshotTest {
    @get:Rule val rule = createComposeRule()

    @Test fun buildHead() {
        var theme by mutableStateOf("light")
        val task = "Clean up the session list (user, 27 Nov 21:52): (1) a chat subtitle shows a helper branch, (2) idle rows need a ring dot"
        rule.setContent {
            AgentViewTheme(theme) {
                Column(Modifier.fillMaxSize().background(av.bg)) {
                    BuildHead("Task 3 of 9 · ${taskTitle(task)}", "Task 3 of 9 · $task")
                    Hairline()
                    Text("Transcript starts here", color = av.fg)
                }
            }
        }
        for (t in listOf("light", "dark")) {
            theme = t
            rule.waitForIdle()
            captureScreenRoboImage("src/test/screenshots/build_head_$t.png")
        }
        rule.onNodeWithText("Task 3 of 9 · Clean up the session list").performClick()
        rule.onNodeWithText("Task 3 of 9 · $task").assertExists()
        captureScreenRoboImage("src/test/screenshots/build_head_open_dark.png")
    }
}

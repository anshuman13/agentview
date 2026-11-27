package no.pradhan.agentview.nativeapp.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.AnnotatedString
import com.github.takahirom.roborazzi.captureScreenRoboImage
import no.pradhan.agentview.nativeapp.codex.autopilot.RunBadge
import no.pradhan.agentview.nativeapp.net.LiveRun
import no.pradhan.agentview.nativeapp.ui.AgentViewTheme
import no.pradhan.agentview.nativeapp.ui.av
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

// The folder row's one badge and the chat rows' dots and Running label; images in src/test/screenshots.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-hdpi")
class SessionRowsScreenshotTest {
    @get:Rule val rule = createComposeRule()

    @Test fun rows() {
        var theme by mutableStateOf("light")
        val now = System.currentTimeMillis() - 7_200_000
        val g = RepoGroup("/repo", "agentview").apply {
            recent += SavedSession("a", "Unread chat", "/repo", lastModified = now)
            recent += SavedSession("b", "Seen chat", "/repo", lastModified = now - 1_000)
            last = now
        }
        val seen = mapOf("a" to now - 1_000, "b" to now - 1_000)
        val actions = RowActions(pinned = false, canPin = true, onPin = {}, onRename = {}, onClose = null, onArchive = {})
        rule.setContent {
            AgentViewTheme(theme) {
                Column(Modifier.fillMaxSize().background(av.groupCard)) {
                    RepoRow(g, seen, emptyList()) {}
                    ChatListRow("Chat view review against Claude", AnnotatedString("feat/rows · Opus 5.5 · Working"), ChatState.Running, false, false, actions, {}, LiveRun("r"), RunBadge.Next, null)
                    ChatListRow("Unread chat", AnnotatedString("2h ago · Replied with the plan"), ChatState.Done, true, false, actions, {}, null, null, null)
                    ChatListRow("Seen chat with a title long enough to be cut at the end", AnnotatedString("Claude · 3h ago"), null, false, false, actions, {}, null, null, null)
                }
            }
        }
        for (t in listOf("light", "dark")) {
            theme = t
            rule.waitForIdle()
            captureScreenRoboImage("src/test/screenshots/session_rows_$t.png")
        }
    }
}

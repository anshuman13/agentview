package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalSheet
import no.pradhan.agentview.nativeapp.codex.autopilot.outcomeDot
import no.pradhan.agentview.nativeapp.codex.autopilot.roundText
import no.pradhan.agentview.nativeapp.codex.clock
import no.pradhan.agentview.nativeapp.net.ChatRun
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.Round
import no.pradhan.agentview.nativeapp.ui.Badge
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.StatusDot
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av

private val QUIET_OUTCOMES = setOf("progress", "quiet", "done")
private const val QUIET_SHOWN = 3
private val OUTCOME_ORDER = listOf("blocked", "question", "failed", "progress", "done", "quiet")

// A chat that opens on too few replies loads earlier pages by itself, a few times.
fun needsEarlier(replies: Int, earlier: Int, autoLoads: Int) = replies < 3 && earlier > 0 && autoLoads < 3

// The rounds that ended after the time the chat was last shown, newest first.
fun roundsSince(rounds: List<Round>, at: Long) = rounds.filter { it.at > at }.asReversed()

fun outcomeCounts(rounds: List<Round>) = OUTCOME_ORDER.map { o -> o to rounds.count { it.outcome == o } }.filter { it.second > 0 }

// More than three quiet rounds fold; blocked, question and failed rounds always show.
fun foldedRounds(rounds: List<Round>, open: Boolean) =
    if (open || rounds.count { it.outcome in QUIET_OUTCOMES } <= QUIET_SHOWN) rounds else rounds.filter { it.outcome !in QUIET_OUTCOMES }

private val unfolded = mutableSetOf<String>()

@Composable
fun SinceSheet(hub: Hub, chat: String, recap: String, rounds: List<Round>, run: ChatRun?, onClose: () -> Unit) {
    var open by remember(chat) { mutableStateOf(chat in unfolded) }
    val shown = foldedRounds(rounds, open)
    val goal = run?.kind == "goal"
    Sheet(onClose, "Since you left", padded = false, action = if (goal) ({
        Button("Open goal", { onClose(); hub.goalSheet.value = GoalSheet.Detail(run!!.id) }, variant = ButtonVariant.Plain, size = ButtonSize.Sm)
    }) else null) {
        if (rounds.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), horizontalArrangement = Arrangement.spacedBy(Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
            outcomeCounts(rounds).forEach { (o, n) -> Badge("$n ${if (o == "quiet") "nothing" else o}", BadgeTone.Quiet) }
            Text(clock(rounds.first().at), style = Type.label, color = av.fgMuted)
        }
        Group { ListRow(recap, lines = 99) }
        if (rounds.isNotEmpty()) Group {
            shown.forEachIndexed { i, r ->
                if (i > 0) Hairline(lead = true)
                ListRow(
                    roundText(r), "${clock(r.at)} · ${r.outcome.replaceFirstChar(Char::uppercase)}",
                    leading = { StatusDot(outcomeDot(r.outcome)) },
                    onClick = r.report?.let { report -> { onClose(); hub.showTurn.value = report } },
                )
            }
            if (shown.size < rounds.size) {
                Hairline()
                Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3)) {
                    Button("Show all ${rounds.size}", { unfolded.add(chat); open = true }, size = ButtonSize.Sm)
                }
            }
        }
    }
}

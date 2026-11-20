package no.pradhan.agentview.nativeapp.chat

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.ui.AvIcon
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av

private const val QUOTE_TEXT_MAX = 1500

// Port of shared/composerText.ts quoteText: a passage of a reply as a Markdown quote for the composer, ending in a blank line.
fun quoteText(text: String): String {
    var body = text.trim()
    if (body.length > QUOTE_TEXT_MAX) body = body.take(QUOTE_TEXT_MAX + 1).replace(Regex("\\s+\\S*\\z"), "").take(QUOTE_TEXT_MAX) + " ..."
    return body.split('\n').joinToString("\n") { if (it.isBlank()) ">" else "> $it" } + "\n\n"
}

// Pick blocks of a reply to quote into the draft (web Quote on a selected passage).
@Composable
fun QuoteSheet(hub: Hub, chat: String, reply: String, onDismiss: () -> Unit) {
    val blocks = remember(reply) { planParagraphs(reply) }
    var picked by remember(reply) { mutableStateOf(setOf<Int>()) }
    val quote = {
        hub.useAgain(chat, quoteText(blocks.filterIndexed { i, _ -> i in picked }.joinToString("\n\n")))
        onDismiss()
    }
    Sheet(onDismiss, "Quote", padded = false, action = {
        Button("Quote ${picked.size}", quote, Modifier.padding(end = Tokens.sp5), variant = ButtonVariant.Filled, size = ButtonSize.Sm, enabled = picked.isNotEmpty())
    }) {
        Group {
            blocks.forEachIndexed { i, b ->
                if (i > 0) Hairline()
                val on = i in picked
                ListRow(b, lines = 4, onClick = { picked = if (on) picked - i else picked + i }, trailing = if (on) { { AvIcon("check", "Picked", Tokens.icon, tint = av.accentText) } } else null)
            }
        }
    }
}

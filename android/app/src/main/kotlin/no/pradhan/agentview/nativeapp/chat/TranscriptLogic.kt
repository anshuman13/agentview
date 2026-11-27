package no.pradhan.agentview.nativeapp.chat

import androidx.compose.ui.unit.Dp
import no.pradhan.agentview.nativeapp.ui.Tokens

internal fun gapAbove(older: Item?, it: Item): Dp? {
    if (older == null) return null
    val act = { i: Item -> i is Item.Step || i is Item.Agent }
    return when {
        act(older) && act(it) -> null
        (act(older) && it is Item.File) || (older is Item.File && act(it)) -> Tokens.sp1
        older is Item.User -> Tokens.sp24
        it is Item.User -> Tokens.sp24
        else -> Tokens.sp4
    }
}

internal fun gapAbove(older: FoldRow?, row: FoldRow): Dp? = when {
    older == null -> null
    older is FoldRow.Row && row is FoldRow.Row -> gapAbove(older.it, row.it)
    (older as? FoldRow.Row)?.it is Item.User -> Tokens.sp24
    (row as? FoldRow.Row)?.it is Item.User -> Tokens.sp24
    else -> Tokens.sp4
}

// Web chat/transcript/window.ts: a chat that opens on too few replies loads earlier pages by itself, a few times.
internal fun needsEarlier(replies: Int, earlier: Int, autoLoads: Int) = replies < EARLIER_REPLIES && earlier > 0 && autoLoads < EARLIER_AUTO_PAGES

private const val EARLIER_REPLIES = 3
private const val EARLIER_AUTO_PAGES = 3

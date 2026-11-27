package no.pradhan.agentview.nativeapp.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.first
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.loadEarlier

// Hides the bottom bar while scrolling away from the newest message.
@Composable
internal fun HideNavOnScroll(hub: Hub, listState: LazyListState, atBottom: Boolean) {
    LaunchedEffect(listState) {
        var last = Int.MAX_VALUE to Int.MAX_VALUE
        snapshotFlow { Triple(listState.isScrollInProgress, listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset) }.collect { (moving, index, offset) ->
            val pos = index to offset
            if (moving && last.first != Int.MAX_VALUE) {
                if (index > last.first || (index == last.first && offset > last.second)) hub.shell.navHidden.value = true
                else if (pos != last) hub.shell.navHidden.value = false
            }
            last = pos
        }
    }
    LaunchedEffect(atBottom) { if (atBottom) hub.shell.navHidden.value = false }
}

// Puts the row at the top of the list; reversed, that is its far edge, so the offset is how much of it is taller than the screen.
private suspend fun LazyListState.scrollToTop(index: Int) {
    scrollToItem(index)
    val size = layoutInfo.visibleItemsInfo.firstOrNull { it.index == index }?.size ?: return
    scrollToItem(index, size - (layoutInfo.viewportSize.height - layoutInfo.beforeContentPadding - layoutInfo.afterContentPadding))
}

// Keeps the newest row in view while the user is at the bottom, and jumps to a turn or a just-sent message.
// A chat opens once with the New line (the row `open`) at the top, held there while the row grows until the reader drags.
@Composable
internal fun FollowNewest(hub: Hub, view: ChatView, list: List<FoldRow>, listState: LazyListState, stick: MutableState<Boolean>, pin: MutableState<Boolean>, atBottom: Boolean, chatId: String, open: String?, lead: Int) {
    val rows = view.rows
    val bottom by rememberUpdatedState(atBottom)
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress to bottom }.collect { (moving, at) -> if (moving) stick.value = at }
    }
    val newest = rows.firstOrNull()?.id
    LaunchedEffect(newest, rows.size) { if (stick.value && newest != null) listState.scrollToItem(0) }
    val turn by hub.showTurn.collectAsState()
    LaunchedEffect(turn, list) {
        val at = list.indexOfFirst { it.key == turn || (it is FoldRow.Fold && it.hidden.any { h -> h.id == turn }) }
        if (at >= 0) { stick.value = false; listState.animateScrollToItem(at) }
        if (turn != null && list.isNotEmpty()) hub.showTurn.value = null
    }
    var opened by rememberSaveable(chatId) { mutableStateOf(false) }
    LaunchedEffect(open, list) {
        if (opened || list.isEmpty()) return@LaunchedEffect
        val at = list.indexOfFirst { it.key == open }
        val info = listState.layoutInfo
        val row = info.visibleItemsInfo.firstOrNull { it.index == at + lead }
        if (at < 0 || !stick.value || turn != null || hub.findRequest.value != null || (row != null && row.offset + row.size <= info.viewportEndOffset)) { opened = true; return@LaunchedEffect }
        opened = true
        stick.value = false
        pin.value = true
        listState.scrollToTop(at + lead)
        if (listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 80) { stick.value = true; pin.value = false }
    }
    LaunchedEffect(listState) { listState.interactionSource.interactions.collect { if (it is DragInteraction.Start) pin.value = false } }
    LaunchedEffect(pin.value, list) {
        if (!pin.value) return@LaunchedEffect
        val at = list.indexOfFirst { it.key == open }
        if (at < 0) return@LaunchedEffect
        val index = at + lead
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == index }?.size }.collect { size ->
            if (size != null && pin.value && !stick.value) listState.scrollToTop(index)
        }
    }
    var lastSent by remember { mutableStateOf<String?>(null) }
    val sent = view.sent
    LaunchedEffect(sent) {
        if (lastSent != null) { stick.value = true; pin.value = false; if (rows.isNotEmpty()) listState.scrollToItem(0) }
        lastSent = sent
    }
}

// Loads earlier messages while the chat shows too few replies, up to three pages, and not again at a hidden count that failed to load; returns whether a load is due.
// Web chat/transcript/window.ts: a chat that opens on too few replies loads earlier pages by itself, a few times.
internal fun needsEarlier(replies: Int, earlier: Int, autoLoads: Int) = replies < EARLIER_REPLIES && earlier > 0 && autoLoads < EARLIER_AUTO_PAGES

private const val EARLIER_REPLIES = 3
private const val EARLIER_AUTO_PAGES = 3

@Composable
internal fun rememberEarlierDue(hub: Hub, chatId: String, replies: Int, loading: Boolean, earlier: Int, settled: Boolean): Boolean {
    var tried by remember(chatId) { mutableStateOf(-1) }
    var autoLoads by remember(chatId) { mutableStateOf(0) }
    val due = settled && !loading && earlier != tried && needsEarlier(replies, earlier, autoLoads)
    LaunchedEffect(due, earlier) { if (due) { tried = earlier; autoLoads++; hub.loadEarlier() } }
    return due
}

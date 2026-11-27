package no.pradhan.agentview.nativeapp.chat

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.MonoFont
import no.pradhan.agentview.nativeapp.ui.Sheet
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.Type
import no.pradhan.agentview.nativeapp.ui.av
import no.pradhan.agentview.nativeapp.workspace.PickedElement
import no.pradhan.agentview.nativeapp.workspace.elementChip

// Elements picked in the Browser screen, as composer chips (web AttachmentsBar ElementChip). A tap opens a sheet with
// the crop of the page, the selector and the text, and a Remove button.
@Composable
internal fun ElementChips(hub: Hub, els: List<PickedElement>) {
    var shown by remember { mutableStateOf<Int?>(null) }
    els.forEachIndexed { i, el -> Chip(elementChip(el), { shown = i }, icon = "inspect") }
    val i = shown ?: return
    val el = els.getOrNull(i) ?: return run { shown = null }
    val shot = remember(el.shot) { runCatching { Base64.decode(el.shot, Base64.DEFAULT).let { BitmapFactory.decodeByteArray(it, 0, it.size) }?.asImageBitmap() }.getOrNull() }
    Sheet(onDismiss = { shown = null }, title = "<${el.tag}>", full = false) {
        if (shot != null) Image(shot, null, Modifier.heightIn(max = Tokens.sp16 * 10).padding(bottom = Tokens.sp4))
        Text(el.selector, style = Type.footnote.copy(fontFamily = MonoFont), color = av.fg)
        if (el.text.isNotEmpty()) Text(el.text.take(200), Modifier.padding(top = Tokens.sp2), style = Type.footnote, color = av.fgMuted, maxLines = 3)
        Text(el.url, Modifier.padding(top = Tokens.sp2), style = Type.footnote, color = av.fgMuted, maxLines = 1)
        Button("Remove", { hub.elements.value = els.filterIndexed { j, _ -> j != i }; shown = null }, Modifier.padding(top = Tokens.sp4), icon = "close")
    }
}

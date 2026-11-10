package no.pradhan.agentview.nativeapp.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import androidx.lifecycle.viewModelScope
import java.io.ByteArrayOutputStream
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.attach
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem

private const val PHOTO_MAX_PX = 2048

// A camera shot scaled to at most 2048 px on its long side and turned upright, so it uploads quickly over the VPN.
private fun shrunkJpeg(file: File): ByteArray? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= PHOTO_MAX_PX) sample *= 2
    val raw = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val turn = when (ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
    val bmp = if (turn == 0f) raw else Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(turn) }, true)
    return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
}

private fun readUri(ctx: Context, uri: Uri) = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }

// The add button with Take photo and Choose photo, or with choose off a camera button; each image is uploaded to the Mac and its path handed to onPath.
@Composable
fun AttachButton(hub: Hub, onUploading: (Int) -> Unit, choose: Boolean = true, onPath: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val attach = rememberAttach(hub, onUploading, onPath)
    if (!choose) return IconBtn("device-camera", "Take photo", attach.takePhoto)
    Box {
        IconBtn("add", "Attach image", { open = true })
        Menu(open, { open = false }) {
            MenuItem("Take photo", "device-camera", { open = false; attach.takePhoto() })
            MenuItem("Choose photo", "file-media", { open = false; attach.choosePhoto() })
        }
    }
}

class Attach(val takePhoto: () -> Unit, val choosePhoto: () -> Unit)

@Composable
fun rememberAttach(hub: Hub, onUploading: (Int) -> Unit, onPath: (String) -> Unit): Attach {
    val ctx = LocalContext.current
    val shot = remember { File(File(ctx.cacheDir, "camera").apply { mkdirs() }, "shot.jpg") }

    // In the Hub's scope, so leaving the screen mid-upload neither cancels it nor leaves the count stuck.
    fun upload(name: String, mime: String, read: () -> ByteArray?) {
        onUploading(1)
        hub.viewModelScope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) { runCatching(read).getOrNull() }
                val path = bytes?.let { hub.attach(name, mime, it) }
                if (path != null) onPath(path) else if (bytes == null) hub.notice.value = "Could not read the image"
            } finally {
                onUploading(-1)
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val mime = ctx.contentResolver.getType(uri) ?: "image/jpeg"
        upload("photo.${mime.substringAfter('/', "jpg").substringBefore('+')}", mime) { readUri(ctx, uri) }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) upload("camera.jpg", "image/jpeg") { shrunkJpeg(shot) }
    }

    val takePhoto = {
        shot.delete()
        runCatching { camera.launch(FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", shot)) }
            .onFailure { hub.notice.value = "No camera app to take a photo" }
        Unit
    }

    return Attach(takePhoto) { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}
